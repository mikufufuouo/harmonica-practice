import {
  listImageSongs,
  importImageFiles,
  deleteImageSong,
  updateImageSong,
  type ImageSong,
} from "./image-score-library.ts";
import { listEntries, type LibraryEntry } from "./score-library.ts";
import { generateFingeringPlan } from "./score/index.ts";
import type { Key } from "./lib/harmonica.ts";
import { openImageScore } from "./image-score-viewer.ts";
import { importScoreZip, exportScoreZip } from "./image-score-package.ts";
import "./private-library.css";
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  return n;
};

export function mountPrivateLibrary(container: HTMLElement): void {
  const section = el("section");
  section.className = "private-library panel";
  section.append(
    el("h2", "我的曲库"),
    el("p", "原图直接看谱，BD 谱继续练习。谱图只保存在当前设备。"),
  );
  const actions = el("div");
  actions.className = "private-actions";
  const zipPick = el("input");
  zipPick.type = "file";
  zipPick.accept = ".zip,application/zip";
  const dirPick = el("input");
  dirPick.type = "file";
  dirPick.multiple = true;
  dirPick.setAttribute("webkitdirectory", "");
  const label = (title: string, input: HTMLElement) => {
    const l = el("label", title);
    l.append(input);
    return l;
  };
  const backup = el("button", "备份图片谱 ZIP");
  actions.append(
    label("导入谱包 ZIP", zipPick),
    label("导入谱包文件夹", dirPick),
    backup,
  );
  const help = el(
    "p",
    "批量选择一个谱包即可加入整套曲谱；重复导入会更新同一曲目。ZIP 含原图，可传到 iPad 后一次导入。清理网站数据会删除本机曲库，请保留谱包备份。",
  );
  help.className = "hint";
  const search = el("input");
  search.type = "search";
  search.placeholder = "搜索曲名、来源或标签";
  search.setAttribute("aria-label", "搜索曲库");
  const filter = el("select");
  filter.setAttribute("aria-label", "曲库筛选");
  for (const [value, name] of [
    ["all", "全部曲目"],
    ["image", "图片谱"],
    ["bd", "BD 谱"],
    ["favorite", "收藏图片谱"],
    ["recent", "最近看谱"],
  ])
    filter.append(new Option(name, value));
  const count = el("p");
  const status = el("p");
  status.setAttribute("role", "status");
  const list = el("div");
  list.className = "private-song-list";
  const paging = el("div");
  paging.className = "private-actions";
  const prev = el("button", "上一批"),
    next = el("button", "下一批"),
    pageLabel = el("span");
  paging.append(prev, pageLabel, next);
  section.append(
    actions,
    help,
    label("查找", search),
    filter,
    count,
    status,
    list,
    paging,
  );
  container.replaceChildren(section);
  let images: ImageSong[] = [],
    bd: LibraryEntry[] = [],
    page = 0,
    busy = false;
  try {
    const state = JSON.parse(
      sessionStorage.getItem("private-library-view") || "{}",
    );
    search.value = typeof state.q === "string" ? state.q : "";
    if (["all", "image", "bd", "favorite", "recent"].includes(state.filter))
      filter.value = state.filter;
    page = Number.isSafeInteger(state.page) && state.page >= 0 ? state.page : 0;
  } catch {
    /* private browsing */
  }
  const saveView = () => {
    try {
      sessionStorage.setItem(
        "private-library-view",
        JSON.stringify({ q: search.value, filter: filter.value, page }),
      );
    } catch {
      /* optional state */
    }
  };
  const error = (e: unknown) => {
    status.textContent = e instanceof Error ? e.message : "操作失败，请重试。";
  };
  async function refresh() {
    try {
      [images, bd] = await Promise.all([listImageSongs(), listEntries()]);
      render();
    } catch (e) {
      error(e);
    }
  }
  function openBd(entry: LibraryEntry) {
    const focus = document.activeElement as HTMLElement | null;
    const dlg = el("dialog");
    dlg.className = "private-bd-dialog";
    const close = el("button", "返回曲库");
    close.onclick = () => dlg.close();
    const key = el("select");
    key.setAttribute("aria-label", "当前琴调");
    ["C", "G", "A", "D", "F", "Bb"].forEach((k) =>
      key.append(new Option(k, k)),
    );
    const notes = el("ol");
    notes.className = "score-sequence";
    const draw = () =>
      notes.replaceChildren(
        ...generateFingeringPlan(entry.sequence, key.value as Key).items.map(
          (n) =>
            el(
              "li",
              n.candidates.map((c) => c.label).join(" / ") ||
                n.reason ||
                "休止",
            ),
        ),
      );
    key.onchange = draw;
    draw();
    dlg.append(
      close,
      el("h2", entry.title),
      el("p", "BD 指法 · 10 孔 Richter 自然音"),
      key,
      notes,
      el("p", entry.sequence.lyrics.map((l) => l.text).join(" / ")),
    );
    dlg.addEventListener(
      "close",
      () => {
        dlg.remove();
        focus?.focus({ preventScroll: true });
      },
      { once: true },
    );
    document.body.append(dlg);
    dlg.showModal();
  }
  function render() {
    const q = search.value.trim().toLocaleLowerCase();
    const linked = new Set(images.map((s) => s.bdEntryId).filter(Boolean));
    let rows: Array<{ title: string; image?: ImageSong; bd?: LibraryEntry }> = [
      ...images.map((image) => ({
        title: image.title,
        image,
        bd: bd.find((b) => b.id === image.bdEntryId),
      })),
      ...bd
        .filter((b) => !linked.has(b.id))
        .map((b) => ({ title: b.title, bd: b })),
    ];
    rows = rows.filter(
      (r) =>
        (!q ||
          [r.title, r.image?.source?.name, ...(r.image?.tags || [])]
            .join(" ")
            .toLocaleLowerCase()
            .includes(q)) &&
        (filter.value === "all" ||
          (filter.value === "image" && r.image) ||
          (filter.value === "bd" && r.bd) ||
          (filter.value === "favorite" && r.image?.favorite) ||
          (filter.value === "recent" && r.image?.lastOpenedAt)),
    );
    rows.sort((a, b) =>
      filter.value === "recent"
        ? (b.image?.lastOpenedAt || "").localeCompare(
            a.image?.lastOpenedAt || "",
          )
        : a.title.localeCompare(b.title, "zh-CN", { numeric: true }),
    );
    const pages = Math.max(1, Math.ceil(rows.length / 30));
    page = Math.min(page, pages - 1);
    saveView();
    count.textContent = `${rows.length} 首 · ${images.length} 首图片谱 / ${bd.length} 首 BD 谱`;
    list.replaceChildren();
    for (const row of rows.slice(page * 30, (page + 1) * 30)) {
      const card = el("article");
      card.className = "private-song";
      const open = el("button", row.title);
      open.className = "private-song-title";
      open.onclick = () => {
        if (row.image) {
          const song = row.image;
          const now = new Date().toISOString();
          song.lastOpenedAt = now;
          void updateImageSong(song.id, { lastOpenedAt: now }).catch(error);
          openImageScore(song);
        } else if (row.bd) openBd(row.bd);
      };
      card.append(
        open,
        el(
          "small",
          row.image
            ? `图片谱 · ${row.image.pages.length} 页${row.bd ? " · BD 谱" : ""} · ${row.image.source?.name || "本地导入"}`
            : "BD 谱 · 结构化音符",
        ),
      );
      if (row.image) {
        const song = row.image;
        const star = el("button", song.favorite ? "★ 已收藏" : "☆ 收藏");
        star.setAttribute(
          "aria-label",
          `${song.favorite ? "取消收藏" : "收藏"} ${song.title}`,
        );
        star.onclick = async () => {
          try {
            await updateImageSong(song.id, { favorite: !song.favorite });
            await refresh();
          } catch (e) {
            error(e);
          }
        };
        const remove = el("button", "删除");
        remove.onclick = async () => {
          if (!confirm(`从本机删除《${song.title}》及未被使用的谱图？`)) return;
          try {
            await deleteImageSong(song.id);
            await refresh();
          } catch (e) {
            error(e);
          }
        };
        const controls = el("div");
        controls.className = "private-actions";
        controls.append(star, remove);
        if (row.bd) {
          const b = el("button", "打开 BD 谱");
          b.onclick = () => openBd(row.bd!);
          controls.append(b);
        }
        card.append(controls);
      }
      list.append(card);
    }
    if (!rows.length)
      list.append(
        el(
          "p",
          images.length || bd.length
            ? "没有匹配的曲目。"
            : "尚无曲谱，先导入一个谱包。",
        ),
      );
    prev.disabled = page === 0;
    next.disabled = page >= pages - 1;
    pageLabel.textContent = `${page + 1} / ${pages}`;
  }
  search.oninput = filter.onchange = () => {
    page = 0;
    render();
  };
  prev.onclick = () => {
    page--;
    render();
  };
  next.onclick = () => {
    page++;
    render();
  };
  async function run(work: () => Promise<string>) {
    if (busy) return;
    busy = true;
    zipPick.disabled = dirPick.disabled = backup.disabled = true;
    status.textContent = "正在处理，请勿关闭页面…";
    try {
      status.textContent = await work();
      await refresh();
    } catch (e) {
      error(e);
    } finally {
      busy = false;
      zipPick.disabled = dirPick.disabled = backup.disabled = false;
      zipPick.value = dirPick.value = "";
    }
  }
  zipPick.onchange = () => {
    const file = zipPick.files?.[0];
    if (file)
      void run(async () => {
        const result = await importScoreZip(file);
        return `已导入 / 更新 ${result.imported} 首图片谱。`;
      });
  };
  dirPick.onchange = () => {
    const files = Array.from(dirPick.files || []);
    if (files.length)
      void run(async () => {
        const result = await importImageFiles(files);
        return `已导入 / 更新 ${result.imported} 首图片谱。`;
      });
  };
  backup.onclick = () =>
    void run(async () => {
      const blob = await exportScoreZip();
      const url = URL.createObjectURL(blob);
      const a = el("a");
      a.href = url;
      a.download = "harmonica-image-scores.zip";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return "图片谱备份已生成，包含原始谱图。BD 谱请在下方单独备份。";
    });
  document.addEventListener("score-library-changed", () => void refresh());
  void refresh();
}
