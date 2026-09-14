import {
  generateFingeringPlan,
  importBdText,
  type NoteSequence,
} from "./score/index.ts";
import type { Key } from "./lib/harmonica.ts";
import {
  deleteDraft,
  deleteEntry,
  getDraft,
  getImage,
  importEntries,
  listDrafts,
  listEntries,
  makeSequence,
  newId,
  saveConfirmedDraft,
  saveDraft,
  type DraftLine,
  type LibraryEntry,
  type ScoreDraft,
  validateLibraryBackup,
} from "./score-library.ts";

const KEYS: readonly Key[] = ["C", "G", "A", "D", "F", "Bb"];
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  return n;
};
const label = (name: string, control: HTMLElement) => {
  const n = el("label", name);
  n.append(control);
  return n;
};
const keySelect = (value: Key | "") => {
  const n = el("select");
  n.append(new Option("请选择原谱琴调", ""));
  KEYS.forEach((key) => n.append(new Option(key, key, false, key === value)));
  return n;
};
const download = (name: string, value: unknown) => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = el("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
};
const bdLike = (value: string) => /[０-９\d]+\s*[ＢＤｂｄBDbd]/.test(value);

export function mountScoreImport(container: HTMLElement): void {
  const root = el("details");
  root.className = "score-import panel";
  root.open = true;
  root.append(el("summary", "图片识别与本地谱库（实验）"));
  const hint = el(
    "p",
    "选择已在相册中裁好的清晰谱图。图片只保存在本机；OCR 在本机运行，首次识别会联网下载并缓存语言模型，图片不会上传。它可能漏行或错读，必须逐行人工确认后才能入库。",
  );
  hint.className = "hint";
  root.append(hint);
  const textPanel = el("details");
  textPanel.append(el("summary", "纯文本 BD 导入预览"));
  const textInput = el("textarea") as HTMLTextAreaElement;
  textInput.rows = 3;
  textInput.placeholder = "4B 4D 5B";
  const textSource = keySelect(""),
    textTarget = keySelect("C"),
    textTranspose = el("input") as HTMLInputElement;
  textTranspose.type = "number";
  textTranspose.min = "-24";
  textTranspose.max = "24";
  textTranspose.value = "0";
  const textGenerate = el("button", "生成文本预览"),
    textExport = el("button", "导出原曲 JSON") as HTMLButtonElement;
  textExport.disabled = true;
  const textStatus = el("p"),
    textView = el("ol");
  textView.className = "score-sequence";
  const textOptions = el("div");
  textOptions.className = "score-options";
  textOptions.append(
    label("BD 文本", textInput),
    label("原谱琴调", textSource),
    label("当前琴调", textTarget),
    label("移调半音", textTranspose),
  );
  textPanel.append(textOptions, textGenerate, textExport, textStatus, textView);
  root.append(textPanel);
  const imagePick = el("input") as HTMLInputElement;
  imagePick.type = "file";
  imagePick.accept = "image/*";
  const title = el("input") as HTMLInputElement;
  title.placeholder = "歌曲名";
  const originalKey = keySelect("");
  const opts = el("div");
  opts.className = "score-options";
  opts.append(
    label("图片", imagePick),
    label("歌曲名", title),
    label("原谱琴调", originalKey),
  );
  root.append(opts);
  const ocrEng = el("button", "识别 BD（英文模型）") as HTMLButtonElement,
    ocrChinese = el("button", "识别 BD + 中文歌词") as HTMLButtonElement,
    cancelOcr = el("button", "取消识别") as HTMLButtonElement,
    confirm = el("button", "确认后存入本地谱库") as HTMLButtonElement;
  cancelOcr.hidden = true;
  confirm.className = "primary";
  const actions = el("div");
  actions.className = "controls";
  actions.append(ocrEng, ocrChinese, cancelOcr, confirm);
  root.append(actions);
  const status = el(
    "p",
    "可先选图后手工逐行录入；OCR 失败时也可继续编辑草稿。",
  );
  status.setAttribute("role", "status");
  root.append(status);
  const preview = el("img") as HTMLImageElement;
  preview.className = "score-image";
  preview.hidden = true;
  root.append(preview);
  const lineBox = el("div");
  lineBox.className = "import-lines";
  root.append(lineBox);
  const fullImage = el("input") as HTMLInputElement;
  fullImage.type = "checkbox";
  root.append(
    label("我已对照原图检查无漏行（OCR 可能遗漏完整一行）", fullImage),
  );
  const draftBox = el("section");
  draftBox.className = "library";
  draftBox.append(el("h2", "未入库草稿"));
  root.append(draftBox);
  const library = el("section");
  library.className = "library";
  library.append(el("h2", "本地谱库"));
  const exportButton = el("button", "导出谱库 JSON"),
    importInput = el("input") as HTMLInputElement;
  importInput.type = "file";
  importInput.accept = "application/json";
  const libActions = el("div");
  libActions.className = "controls";
  libActions.append(exportButton, label("导入 JSON", importInput));
  const entriesBox = el("div");
  library.append(libActions, entriesBox);
  root.append(library);
  container.replaceChildren(root);
  let draft: ScoreDraft | null = null,
    imageUrl: string | null = null,
    ocrGeneration = 0,
    textSequence: NoteSequence | null = null,
    saving = false;
  let activeWorker: { terminate(): Promise<unknown> } | null = null;
  let ocrCommitting = false;
  const report = (message: string) => {
    status.textContent = message;
  };
  const releasePreview = () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = null;
    preview.hidden = true;
  };
  async function persist() {
    if (!draft) return;
    draft.title = title.value;
    draft.sourceKey = originalKey.value as Key | "";
    draft.updatedAt = new Date().toISOString();
    try {
      await saveDraft(draft);
    } catch {
      report("无法写入浏览器本地存储；请检查浏览器存储空间或隐私模式。");
    }
  }
  function setOcrBusy(busy: boolean) {
    [imagePick, title, originalKey, confirm, fullImage].forEach(
      (control) => (control.disabled = busy),
    );
    ocrEng.disabled = ocrChinese.disabled = busy;
    cancelOcr.hidden = !busy;
    lineBox
      .querySelectorAll("input, textarea, select, button")
      .forEach((control) => ((control as HTMLInputElement).disabled = busy));
    draftBox
      .querySelectorAll("button")
      .forEach((control) => ((control as HTMLButtonElement).disabled = busy));
  }
  function renderLines() {
    lineBox.replaceChildren();
    if (!draft) return;
    fullImage.checked = draft.fullImageConfirmed;
    draft.lines.forEach((line, index) => {
      const row = el("div");
      row.className = "import-line";
      const kind = el("select") as HTMLSelectElement;
      [
        ["bd", "BD 音符"],
        ["lyrics", "歌词/文字"],
        ["ignore", "忽略（已审阅）"],
      ].forEach(([v, t]) =>
        kind.append(new Option(t, v, false, v === line.kind)),
      );
      const text = el("textarea") as HTMLTextAreaElement;
      text.rows = 2;
      text.value = line.edited;
      const checked = el("input") as HTMLInputElement;
      checked.type = "checkbox";
      checked.checked = line.confirmed;
      const checkedLabel = label("本行已核对", checked);
      const remove = el("button", "删除");
      const original = el(
        "small",
        `OCR 原文：${line.original || "（手工新增行）"}`,
      );
      kind.onchange = () => {
        line.kind = kind.value as DraftLine["kind"];
        line.confirmed = false;
        draft!.fullImageConfirmed = false;
        void persist();
        renderLines();
      };
      text.oninput = () => {
        line.edited = text.value;
        line.confirmed = false;
        draft!.fullImageConfirmed = false;
        fullImage.checked = false;
        checked.checked = false;
        void persist();
      };
      checked.onchange = () => {
        line.confirmed = checked.checked;
        void persist();
      };
      remove.onclick = () => {
        draft!.lines.splice(index, 1);
        draft!.fullImageConfirmed = false;
        void persist();
        renderLines();
      };
      row.append(kind, text, checkedLabel, remove, original);
      lineBox.append(row);
    });
    const add = el("button", "追加手工行");
    add.onclick = () => {
      draft!.lines.push({
        id: newId(),
        kind: "bd",
        original: "",
        edited: "",
        confirmed: false,
      });
      draft!.fullImageConfirmed = false;
      void persist();
      renderLines();
    };
    lineBox.append(add);
  }
  async function showSequence(entry: LibraryEntry) {
    const pane = el("div");
    pane.className = "score-sequence";
    const target = keySelect("C");
    const exportSong = el("button", "导出原曲 JSON");
    const imageButton = el("button", "查看原图");
    const list = el("ol");
    const lyrics = el("p");
    const render = () => {
      if (!KEYS.includes(target.value as Key)) {
        list.replaceChildren(el("li", "请选择当前琴调。"));
        return;
      }
      const key = target.value as Key;
      list.replaceChildren(
        ...generateFingeringPlan(entry.sequence, key).items.map((item) =>
          el(
            "li",
            item.candidates.map((candidate) => candidate.label).join(" / ") ||
              `不可奏：${item.reason ?? "原因未知"}`,
          ),
        ),
      );
      lyrics.textContent = entry.sequence.lyrics.length
        ? `歌词（未逐字对齐）：${entry.sequence.lyrics.map((line) => line.text).join(" / ")}`
        : "无歌词";
    };
    target.onchange = render;
    exportSong.onclick = () => download(`${entry.title}.json`, entry.sequence);
    imageButton.onclick = async () => {
      try {
        const blob = entry.assetId ? await getImage(entry.assetId) : null;
        if (!blob) {
          report("此导入 JSON 不含原图，或原图已删除。");
          return;
        }
        const url = URL.createObjectURL(blob);
        const image = el("img") as HTMLImageElement;
        image.className = "score-image";
        image.src = url;
        image.onload = () => URL.revokeObjectURL(url);
        pane.append(image);
      } catch {
        report("无法读取原图。");
      }
    };
    pane.append(
      el("h3", entry.title),
      label("当前琴调", target),
      exportSong,
      imageButton,
      lyrics,
      list,
    );
    render();
    entriesBox.prepend(pane);
  }
  async function renderLibrary() {
    entriesBox.replaceChildren();
    try {
      const entries = (await listEntries()).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      );
      if (!entries.length) entriesBox.append(el("p", "尚无已确认歌曲。"));
      entries.forEach((entry: LibraryEntry) => {
        const row = el("article");
        const open = el("button", `打开：${entry.title}`),
          remove = el("button", "删除");
        open.onclick = () => void showSequence(entry);
        remove.onclick = async () => {
          try {
            await deleteEntry(entry.id);
            await renderLibrary();
          } catch {
            report("无法删除本地歌曲。");
          }
        };
        row.append(
          open,
          el(
            "small",
            `${entry.sequence.events.length} 个事件 · ${entry.sequence.timeBase === "unmetered" ? "节奏未知" : "带时间"}`,
          ),
          remove,
        );
        entriesBox.append(row);
      });
    } catch {
      entriesBox.append(el("p", "无法读取本地谱库。"));
    }
  }
  async function renderDrafts() {
    draftBox.replaceChildren(el("h2", "未入库草稿"));
    const drafts = (await listDrafts()).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    drafts.forEach((item) => {
      const row = el("article");
      const open = el("button", `打开：${item.title}`),
        remove = el("button", "删除");
      open.onclick = async () => {
        try {
          const latest = await getDraft(item.id);
          if (latest) await loadDraft(latest);
        } catch {
          report("无法打开草稿。");
        }
      };
      remove.onclick = async () => {
        try {
          await deleteDraft(item.id);
          if (draft?.id === item.id) {
            draft = null;
            releasePreview();
            renderLines();
          }
          await renderDrafts();
        } catch {
          report("无法删除草稿。");
        }
      };
      row.append(open, remove);
      draftBox.append(row);
    });
  }
  async function loadDraft(saved: ScoreDraft) {
    const generation = ++ocrGeneration;
    draft = saved;
    title.value = saved.title;
    originalKey.value = saved.sourceKey;
    releasePreview();
    try {
      const blob = await getImage(saved.assetId);
      if (generation !== ocrGeneration) return;
      if (blob) {
        imageUrl = URL.createObjectURL(blob);
        preview.src = imageUrl;
        preview.hidden = false;
      }
    } catch {
      report("草稿已恢复，但原图无法读取。");
    }
    renderLines();
  }
  async function createDraft(file: File) {
    ocrGeneration++;
    setOcrBusy(false);
    releasePreview();
    const now = new Date().toISOString();
    draft = {
      version: 1,
      id: newId(),
      title: file.name.replace(/\.[^.]+$/, ""),
      sourceKey: "",
      assetId: newId(),
      imageName: file.name,
      createdAt: now,
      updatedAt: now,
      ocrOriginal: "",
      lines: [],
      fullImageConfirmed: false,
    };
    title.value = draft.title;
    originalKey.value = "";
    imageUrl = URL.createObjectURL(file);
    preview.src = imageUrl;
    preview.hidden = false;
    try {
      await saveDraft(draft, file);
      report("原图与草稿已保存在本机；可手工加行，或开始 OCR。");
      await renderDrafts();
    } catch {
      report("无法保存原图；请检查浏览器本地存储。");
    }
    renderLines();
  }
  async function runOcr(langs: string) {
    if (!draft) {
      report("请先选择图片。");
      return;
    }
    if (
      draft.lines.length &&
      !window.confirm("重新识别会替换当前未入库的逐行校对结果，是否继续？")
    )
      return;
    const generation = ++ocrGeneration,
      targetDraft = draft;
    let worker: Awaited<
      ReturnType<(typeof import("tesseract.js"))["createWorker"]>
    > | null = null;
    setOcrBusy(true);
    report("正在下载或读取本地 OCR 模型并识别；本次草稿编辑已锁定。");
    try {
      const blob = await getImage(targetDraft.assetId);
      if (generation !== ocrGeneration) return;
      if (!blob) throw new Error("找不到本地原图");
      const { createWorker, PSM } = await import("tesseract.js");
      let rejectInitialization: ((reason: Error) => void) | null = null;
      let initializationFailed = false;
      const initializationFailure = new Promise<never>((_, reject) => {
        rejectInitialization = reject;
      });
      const createPromise = createWorker(langs, undefined, {
        logger: (event) => {
          if (generation === ocrGeneration)
            report(`OCR：${event.status} ${Math.round(event.progress * 100)}%`);
        },
        errorHandler: (reason) => {
          initializationFailed = true;
          rejectInitialization?.(
            reason instanceof Error ? reason : new Error(String(reason)),
          );
        },
      });
      void createPromise.then(
        (lateWorker) => {
          if (initializationFailed || generation !== ocrGeneration)
            void lateWorker.terminate().catch(() => undefined);
        },
        () => undefined,
      );
      const createdWorker = await Promise.race([
        createPromise,
        initializationFailure,
      ]);
      worker = createdWorker;
      if (generation !== ocrGeneration) return;
      activeWorker = worker;
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      const result = await worker.recognize(blob);
      if (generation !== ocrGeneration || targetDraft !== draft) return;
      const raw = result.data.text.replace(/\r/g, "");
      const nextDraft: ScoreDraft = {
        ...targetDraft,
        ocrOriginal: raw,
        lines: raw
          .split("\n")
          .filter((line) => line.trim())
          .map((line) => ({
            id: newId(),
            kind: bdLike(line) ? "bd" : "lyrics",
            original: line,
            edited: line,
            confirmed: false,
          })),
        fullImageConfirmed: false,
        updatedAt: new Date().toISOString(),
      };
      ocrCommitting = true;
      cancelOcr.disabled = true;
      await saveDraft(nextDraft);
      ocrCommitting = false;
      if (generation !== ocrGeneration || targetDraft !== draft) return;
      draft = nextDraft;
      renderLines();
      report(
        `OCR 完成：保留 ${nextDraft.lines.length} 行原文。请检查类型、补漏行和错字，再逐行确认。`,
      );
    } catch (error) {
      if (generation === ocrGeneration)
        report(
          `OCR 未完成：${error instanceof Error ? error.message : "未知错误"}。可继续手工校对。`,
        );
    } finally {
      if (generation === ocrGeneration) {
        ocrCommitting = false;
        cancelOcr.disabled = false;
      }
      if (worker) await worker.terminate().catch(() => undefined);
      if (activeWorker === worker) activeWorker = null;
      if (generation === ocrGeneration) setOcrBusy(false);
    }
  }
  imagePick.onchange = () => {
    const file = imagePick.files?.[0];
    if (file) void createDraft(file);
  };
  title.oninput = () => {
    if (draft) {
      draft.fullImageConfirmed = false;
      fullImage.checked = false;
    }
    void persist();
  };
  originalKey.onchange = () => {
    if (draft) {
      draft.lines.forEach((line) => (line.confirmed = false));
      draft.fullImageConfirmed = false;
      renderLines();
    }
    void persist();
  };
  fullImage.onchange = () => {
    if (draft) {
      draft.fullImageConfirmed = fullImage.checked;
      void persist();
    }
  };
  ocrEng.onclick = () => void runOcr("eng");
  ocrChinese.onclick = () => void runOcr("eng+chi_sim");
  cancelOcr.onclick = () => {
    if (ocrCommitting) {
      report("识别结果正在保存，暂不能取消。");
      return;
    }
    ocrGeneration++;
    void activeWorker?.terminate().catch(() => undefined);
    activeWorker = null;
    setOcrBusy(false);
    report("已取消 OCR；原草稿未被替换。");
  };
  const renderText = () => {
    if (!textSequence) return;
    const semitones = Number(textTranspose.value);
    if (!KEYS.includes(textTarget.value as Key)) {
      textView.replaceChildren();
      textStatus.textContent = "请选择当前琴调。";
      return;
    }
    if (!Number.isInteger(semitones) || semitones < -24 || semitones > 24) {
      textView.replaceChildren();
      textStatus.textContent = "移调请输入 -24 到 24 的整数。";
      return;
    }
    const plan = generateFingeringPlan(textSequence, textTarget.value as Key, {
      transposeSemitones: semitones,
    });
    textView.replaceChildren(
      ...plan.items.map((item) =>
        el(
          "li",
          item.candidates.map((candidate) => candidate.label).join(" / ") ||
            `不可奏：${item.reason ?? "原因未知"}`,
        ),
      ),
    );
    textStatus.textContent = `${textSequence.events.length} 个事件；${textSequence.lyrics.length ? `歌词 ${textSequence.lyrics.map((line) => line.text).join(" / ")}` : "无歌词"}；节奏未知。`;
  };
  const invalidateText = () => {
    textSequence = null;
    textExport.disabled = true;
    textView.replaceChildren();
    textStatus.textContent = "文本或原谱琴调已改变，请重新生成预览。";
  };
  textInput.oninput = invalidateText;
  textSource.onchange = invalidateText;
  textGenerate.onclick = () => {
    const result = importBdText(textInput.value, {
      sourceKey: (textSource.value as Key) || null,
      title: "BD 导入歌曲",
    });
    textSequence = result.sequence;
    textExport.disabled = !textSequence;
    if (textSequence) renderText();
    else
      textStatus.textContent = result.diagnostics
        .map((item) => item.message)
        .join(" ");
  };
  textTarget.onchange = renderText;
  textTranspose.onchange = renderText;
  textExport.onclick = () => {
    if (textSequence) download(`${textSequence.title}.json`, textSequence);
  };
  confirm.onclick = async () => {
    if (saving) return;
    if (!draft) {
      report("请先选择图片或恢复草稿。");
      return;
    }
    const prepared = makeSequence(draft);
    if (!prepared.sequence) {
      renderLines();
      report(`尚不能入库：${prepared.errors.join(" ")}`);
      return;
    }
    saving = true;
    confirm.disabled = true;
    try {
      const entry = await saveConfirmedDraft(draft);
      report(`已存入本机谱库：${entry.title}。`);
      await renderLibrary();
    } catch (error) {
      report(
        `存库失败：${error instanceof Error ? error.message : "未知错误"}`,
      );
    } finally {
      saving = false;
      confirm.disabled = false;
    }
  };
  exportButton.onclick = async () => {
    try {
      download("harmonica-score-library.json", {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        entries: await listEntries(),
      });
    } catch {
      report("无法导出本地谱库。");
    }
  };
  importInput.onchange = async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      const result = validateLibraryBackup(
        JSON.parse(await file.text()) as unknown,
      );
      if (result.errors.length)
        report(`导入被拒绝：${result.errors.join(" ")}`);
      else {
        await importEntries(result.entries);
        report(`已导入 ${result.entries.length} 首歌曲（JSON 不包含原图）。`);
        await renderLibrary();
      }
    } catch {
      report("导入被拒绝：不是有效 JSON。");
    } finally {
      importInput.value = "";
    }
  };
  void Promise.all([listDrafts(), renderLibrary(), renderDrafts()])
    .then(([drafts]) => {
      if (drafts.length) {
        const latest = drafts.sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        )[0];
        void loadDraft(latest);
        report(`已恢复草稿：${latest.title}。`);
      }
    })
    .catch(() => report("当前浏览器无法使用 IndexedDB；可尝试关闭隐私模式。"));
}
