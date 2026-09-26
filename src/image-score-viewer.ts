import { getScoreImage, type ImageSong } from "./image-score-library.ts";
import "./image-score.css";

type OpenOptions = { onClose?: () => void };

const SESSION_PREFIX = "harmonica-image-score-page:";
const MIN_SCALE = 0.01;
const MAX_SCALE = 8;

function pageStorageKey(songId: string): string {
  return `${SESSION_PREFIX}${songId}`;
}

function storedPage(song: ImageSong): number {
  try {
    const value = Number(sessionStorage.getItem(pageStorageKey(song.id)));
    return Number.isInteger(value) && value >= 0 && value < song.pages.length
      ? value
      : 0;
  } catch {
    return 0;
  }
}

function rememberPage(song: ImageSong, page: number): void {
  try {
    sessionStorage.setItem(pageStorageKey(song.id), String(page));
  } catch {
    // Private browsing can reject storage. Viewing still works without memory.
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Opens one locally stored image score. Only the visible page is read. */
export function openImageScore(
  song: ImageSong,
  options: OpenOptions = {},
): void {
  if (!song.pages.length) return;

  const restoreScrollX = window.scrollX;
  const restoreScrollY = window.scrollY;
  const restoreFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const abort = new AbortController();
  let generation = 0;
  let objectUrl: string | null = null;
  let page = storedPage(song);
  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let imageWidth = 0;
  let imageHeight = 0;
  let didClose = false;
  const pointers = new Map<number, { x: number; y: number }>();
  let panStart: { x: number; y: number; tx: number; ty: number } | null = null;
  let pinchStart: {
    distance: number;
    scale: number;
    x: number;
    y: number;
    contentX: number;
    contentY: number;
  } | null = null;

  const dialog = document.createElement("dialog");
  dialog.className = "image-score-dialog";
  dialog.setAttribute("aria-label", `${song.title} 图片谱`);
  const header = document.createElement("header");
  header.className = "image-score-toolbar";
  const title = document.createElement("strong");
  title.className = "image-score-title";
  title.textContent = song.title;
  const status = document.createElement("span");
  status.className = "image-score-status";
  status.setAttribute("role", "status");
  const controls = document.createElement("div");
  controls.className = "image-score-controls";
  const previous = button("上一页");
  const counter = document.createElement("span");
  counter.className = "image-score-counter";
  const next = button("下一页");
  const zoomOut = button("缩小");
  const reset = button("复位");
  const fullPage = button("整页");
  const zoomIn = button("放大");
  const fullscreen = button("全屏");
  const close = button("关闭");
  close.classList.add("image-score-close");
  controls.append(
    previous,
    counter,
    next,
    zoomOut,
    reset,
    fullPage,
    zoomIn,
    fullscreen,
    close,
  );
  header.append(title, status, controls);

  const viewport = document.createElement("div");
  viewport.className = "image-score-viewport";
  viewport.tabIndex = 0;
  viewport.setAttribute("aria-label", "曲谱图片；可拖动、双指或滚轮缩放");
  const stage = document.createElement("div");
  stage.className = "image-score-stage";
  const image = document.createElement("img");
  image.className = "image-score-image";
  image.alt = `${song.title} 第 ${page + 1} 页`;
  image.draggable = false;
  stage.append(image);
  viewport.append(stage);
  dialog.append(header, viewport);
  document.body.append(dialog);

  function button(text: string): HTMLButtonElement {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = text;
    return element;
  }
  function applyTransform(): void {
    stage.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
  }
  function updateControls(): void {
    previous.disabled = page === 0;
    next.disabled = page === song.pages.length - 1;
    counter.textContent = `${page + 1} / ${song.pages.length}`;
  }
  function fitWidth(): void {
    if (!imageWidth || !imageHeight) return;
    const width = viewport.clientWidth;
    if (!width) return;
    scale = clamp((width / imageWidth) * 0.96, MIN_SCALE, 1);
    translateX = (width - imageWidth * scale) / 2;
    translateY = 8;
    applyTransform();
  }
  function fitPage(): void {
    if (!imageWidth || !imageHeight) return;
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    if (!width || !height) return;
    scale = clamp(
      Math.min(width / imageWidth, height / imageHeight) * 0.96,
      MIN_SCALE,
      1,
    );
    translateX = (width - imageWidth * scale) / 2;
    translateY = (height - imageHeight * scale) / 2;
    applyTransform();
  }
  function zoomAt(clientX: number, clientY: number, nextScale: number): void {
    const rect = viewport.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const bounded = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    const contentX = (x - translateX) / scale;
    const contentY = (y - translateY) / scale;
    scale = bounded;
    translateX = x - contentX * scale;
    translateY = y - contentY * scale;
    applyTransform();
  }
  function setStatus(message: string): void {
    status.textContent = message;
  }
  function clearImage(): void {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    image.removeAttribute("src");
  }
  async function loadPage(targetPage: number): Promise<void> {
    const request = ++generation;
    viewport.replaceChildren(stage);
    pointers.clear();
    panStart = null;
    pinchStart = null;
    page = clamp(targetPage, 0, song.pages.length - 1);
    rememberPage(song, page);
    updateControls();
    clearImage();
    imageWidth = imageHeight = 0;
    setStatus("正在读取本页图片…");
    try {
      const blob = await getScoreImage(song.pages[page].assetId);
      if (request !== generation || didClose) return;
      if (!blob) throw new Error("missing");
      objectUrl = URL.createObjectURL(blob);
      image.src = objectUrl;
      await image.decode();
      if (request !== generation || didClose) return;
      imageWidth = image.naturalWidth;
      imageHeight = image.naturalHeight;
      image.alt = `${song.title} 第 ${page + 1} 页`;
      setStatus("");
      fitWidth();
    } catch {
      if (request !== generation || didClose) return;
      clearImage();
      setStatus("本页图片无法读取。");
      const retry = button("重试");
      retry.className = "image-score-retry";
      retry.addEventListener("click", () => void loadPage(page), {
        signal: abort.signal,
      });
      viewport.replaceChildren(stage, retry);
    }
  }
  function closeViewer(): void {
    if (didClose) return;
    didClose = true;
    generation++;
    clearImage();
    abort.abort();
    if (document.fullscreenElement === dialog)
      void document.exitFullscreen?.().catch(() => undefined);
    dialog.remove();
    window.scrollTo(restoreScrollX, restoreScrollY);
    restoreFocus?.focus({ preventScroll: true });
    options.onClose?.();
  }
  function pointerDistance(): {
    x: number;
    y: number;
    distance: number;
  } | null {
    const [a, b] = [...pointers.values()];
    if (!a || !b) return null;
    const x = (a.x + b.x) / 2;
    const y = (a.y + b.y) / 2;
    return { x, y, distance: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  previous.addEventListener("click", () => void loadPage(page - 1), {
    signal: abort.signal,
  });
  next.addEventListener("click", () => void loadPage(page + 1), {
    signal: abort.signal,
  });
  zoomOut.addEventListener(
    "click",
    () =>
      zoomAt(
        viewport.getBoundingClientRect().left + viewport.clientWidth / 2,
        viewport.getBoundingClientRect().top + viewport.clientHeight / 2,
        scale / 1.25,
      ),
    { signal: abort.signal },
  );
  zoomIn.addEventListener(
    "click",
    () =>
      zoomAt(
        viewport.getBoundingClientRect().left + viewport.clientWidth / 2,
        viewport.getBoundingClientRect().top + viewport.clientHeight / 2,
        scale * 1.25,
      ),
    { signal: abort.signal },
  );
  reset.addEventListener("click", fitWidth, { signal: abort.signal });
  fullPage.addEventListener("click", fitPage, { signal: abort.signal });
  close.addEventListener("click", () => dialog.close(), {
    signal: abort.signal,
  });
  fullscreen.addEventListener(
    "click",
    () => {
      if (document.fullscreenElement === dialog) {
        void document.exitFullscreen?.().catch(() => undefined);
      } else if (dialog.classList.contains("image-score-fullscreen-fallback")) {
        dialog.classList.remove("image-score-fullscreen-fallback");
        fullscreen.textContent = "全屏";
        setStatus("");
      } else if (dialog.requestFullscreen) {
        void dialog.requestFullscreen().catch(() => {
          dialog.classList.add("image-score-fullscreen-fallback");
          fullscreen.textContent = "退出全屏";
          setStatus("沉浸式全屏模式");
        });
      } else {
        dialog.classList.add("image-score-fullscreen-fallback");
        fullscreen.textContent = "退出全屏";
        setStatus("沉浸式全屏模式");
      }
    },
    { signal: abort.signal },
  );
  dialog.addEventListener("close", closeViewer, { signal: abort.signal });
  dialog.addEventListener(
    "cancel",
    (event) => {
      if (dialog.classList.contains("image-score-fullscreen-fallback")) {
        event.preventDefault();
        dialog.classList.remove("image-score-fullscreen-fallback");
        fullscreen.textContent = "全屏";
        setStatus("");
      }
    },
    { signal: abort.signal },
  );
  document.addEventListener(
    "fullscreenchange",
    () => {
      if (!document.fullscreenElement)
        dialog.classList.remove("image-score-fullscreen-fallback");
      fullscreen.textContent =
        document.fullscreenElement === dialog ? "退出全屏" : "全屏";
      requestAnimationFrame(fitWidth);
    },
    { signal: abort.signal },
  );
  window.addEventListener("resize", () => requestAnimationFrame(fitWidth), {
    signal: abort.signal,
  });
  window.addEventListener(
    "orientationchange",
    () => requestAnimationFrame(fitWidth),
    { signal: abort.signal },
  );
  viewport.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      zoomAt(
        event.clientX,
        event.clientY,
        scale * (event.deltaY > 0 ? 0.88 : 1.14),
      );
    },
    { passive: false, signal: abort.signal },
  );
  viewport.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      viewport.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const pinch = pointerDistance();
      if (pinch && pinch.distance > 0) {
        pinchStart = {
          ...pinch,
          scale,
          contentX:
            (pinch.x - viewport.getBoundingClientRect().left - translateX) /
            scale,
          contentY:
            (pinch.y - viewport.getBoundingClientRect().top - translateY) /
            scale,
        };
        panStart = null;
      } else
        panStart = {
          x: event.clientX,
          y: event.clientY,
          tx: translateX,
          ty: translateY,
        };
    },
    { signal: abort.signal },
  );
  viewport.addEventListener(
    "pointermove",
    (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const pinch = pointerDistance();
      if (pinch && pinchStart && pinchStart.distance > 0) {
        const nextScale = clamp(
          (pinchStart.scale * pinch.distance) / pinchStart.distance,
          MIN_SCALE,
          MAX_SCALE,
        );
        const rect = viewport.getBoundingClientRect();
        scale = nextScale;
        translateX = pinch.x - rect.left - pinchStart.contentX * scale;
        translateY = pinch.y - rect.top - pinchStart.contentY * scale;
        applyTransform();
      } else if (panStart) {
        translateX = panStart.tx + event.clientX - panStart.x;
        translateY = panStart.ty + event.clientY - panStart.y;
        applyTransform();
      }
    },
    { signal: abort.signal },
  );
  const endPointer = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 1) {
      const rest = [...pointers.values()][0];
      panStart = { x: rest.x, y: rest.y, tx: translateX, ty: translateY };
    } else panStart = null;
  };
  viewport.addEventListener("pointerup", endPointer, { signal: abort.signal });
  viewport.addEventListener("pointercancel", endPointer, {
    signal: abort.signal,
  });
  viewport.addEventListener("lostpointercapture", endPointer, {
    signal: abort.signal,
  });
  dialog.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (page) void loadPage(page - 1);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (page < song.pages.length - 1) void loadPage(page + 1);
      }
      if (
        event.key === "Escape" &&
        dialog.classList.contains("image-score-fullscreen-fallback")
      ) {
        event.preventDefault();
        dialog.classList.remove("image-score-fullscreen-fallback");
        fullscreen.textContent = "全屏";
        setStatus("");
      }
    },
    { signal: abort.signal },
  );

  dialog.showModal();
  void loadPage(page);
}
