import {
  generateFingeringPlan,
  importBdText,
  type NoteSequence,
} from "./score/index.ts";
import type { Key } from "./lib/harmonica.ts";

const KEYS: readonly Key[] = ["C", "G", "A", "D", "F", "Bb"];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function keySelect(placeholder: string, value: Key | ""): HTMLSelectElement {
  const select = el("select");
  const first = el("option", placeholder);
  first.value = "";
  select.append(first);
  KEYS.forEach((key) => {
    const option = el("option", key);
    option.value = key;
    if (key === value) option.selected = true;
    select.append(option);
  });
  return select;
}

function labelFor(text: string, control: HTMLElement): HTMLLabelElement {
  const label = el("label", text);
  label.append(control);
  return label;
}

function pitchName(midi: number): string {
  const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

function downloadSequence(sequence: NoteSequence) {
  const anchor = el("a");
  const url = URL.createObjectURL(new Blob([JSON.stringify(sequence, null, 2)], { type: "application/json" }));
  anchor.href = url;
  anchor.download = `${sequence.title || "song"}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function mountScoreImport(container: HTMLElement): void {
  const details = el("details");
  details.className = "score-import panel";
  const summary = el("summary", "BD 谱面导入预览");
  details.append(summary);

  const intro = el("p", "先粘贴公众号 BD 文本；图片导入计划中，本轮可手工录入图中文字。当前只支持 1–10 孔自然 B/D；歌词行会保留但尚未对齐，压音、和弦和节奏暂不解析。未来可接入 MIDI、MusicXML、简谱和音频转录。");
  intro.className = "hint";
  details.append(intro);

  const textarea = el("textarea") as HTMLTextAreaElement;
  textarea.rows = 5;
  textarea.placeholder = "例如：4B 4D 5B\n（仅示例片段，不含完整歌曲）";
  textarea.setAttribute("aria-label", "BD 谱文本");
  details.append(textarea);

  const originalKey = keySelect("请选择原谱琴调", "");
  const targetKey = keySelect("当前琴调", "C");
  const transpose = el("input") as HTMLInputElement;
  transpose.type = "number";
  transpose.min = "-24";
  transpose.max = "24";
  transpose.step = "1";
  transpose.value = "0";
  transpose.inputMode = "numeric";
  const options = el("div");
  options.className = "score-options";
  const transposeHint = el("small", "0 保持原音高；换琴不会自动移调。");
  options.append(labelFor("原谱琴调", originalKey), labelFor("当前琴调", targetKey), labelFor("移调半音", transpose), transposeHint);
  details.append(options);

  const actions = el("div");
  actions.className = "controls";
  const demo = el("button", "填入演示片段");
  const generate = el("button", "生成预览");
  generate.className = "primary";
  const exportButton = el("button", "导出歌曲 JSON（原曲）");
  const exportHint = el("small", "导出保存原曲 NoteSequence，不含当前琴调或移调生成的指法。");
  exportButton.disabled = true;
  actions.append(demo, generate, exportButton, exportHint);
  details.append(actions);

  const diagnostics = el("div");
  diagnostics.className = "score-diagnostics";
  diagnostics.setAttribute("aria-live", "polite");
  const summaryText = el("p");
  const sequenceView = el("ol");
  sequenceView.className = "score-sequence";
  const lyricsDetails = el("details");
  const lyricsSummary = el("summary", "歌词与文字（尚未与音符对齐）");
  const lyricsView = el("div");
  lyricsDetails.append(lyricsSummary, lyricsView);
  lyricsDetails.hidden = true;
  details.append(diagnostics, summaryText, sequenceView, lyricsDetails);

  let sequence: NoteSequence | null = null;
  let previewValid = false;

  function invalidate() {
    sequence = null;
    previewValid = false;
    exportButton.disabled = true;
    summaryText.textContent = "谱文或原谱琴调已改变，请重新生成预览。";
    sequenceView.replaceChildren();
    lyricsView.replaceChildren();
    lyricsDetails.hidden = true;
  }

  function showDiagnostics(items: ReturnType<typeof importBdText>["diagnostics"]) {
    diagnostics.replaceChildren();
    items.forEach((diagnostic) => {
      const row = el("p");
      row.className = `diagnostic diagnostic-${diagnostic.severity}`;
      row.textContent = `${diagnostic.severity === "error" ? "错误" : diagnostic.severity === "warning" ? "提示" : "信息"} · 第${diagnostic.line}行第${diagnostic.column}列${diagnostic.token ? `「${diagnostic.token}」` : ""}：${diagnostic.message}`;
      diagnostics.append(row);
    });
  }

  function renderPlan() {
    if (!sequence || !previewValid || !targetKey.value) {
      if (!targetKey.value) summaryText.textContent = "请选择当前琴调以查看指法预览。";
      sequenceView.replaceChildren();
      return;
    }
    const importedSequence = sequence;
    const semitones = Number(transpose.value);
    if (!Number.isInteger(semitones) || semitones < -24 || semitones > 24) {
      summaryText.textContent = "移调请输入 -24 到 24 之间的整数。";
      sequenceView.replaceChildren();
      return;
    }
    const plan = generateFingeringPlan(importedSequence, targetKey.value as Key, { transposeSemitones: semitones });
    sequenceView.replaceChildren();
    lyricsView.replaceChildren();
    const lyrics = importedSequence.lyrics;
    if (lyrics?.length) {
      lyrics.forEach((line) => lyricsView.append(el("p", line.text)));
      lyricsDetails.hidden = false;
    }
    let unplayable = 0;
    let ambiguous = 0;
    plan.items.forEach((item, index) => {
      const event = importedSequence.events.find((candidate) => candidate.id === item.eventId);
      const row = el("li");
      const pitch = event?.kind === "note" ? `${event.pitch.spelling ?? pitchName(event.pitch.midi)}${semitones ? ` → ${pitchName(event.pitch.midi + semitones)}` : ""}（MIDI ${event.pitch.midi}）` : "休止";
      const candidates = item.candidates.length ? item.candidates.map((candidate) => candidate.label).join(" / ") : "—";
      row.textContent = `${index + 1}. ${candidates} · ${item.status === "ambiguous" ? "同音候选" : item.status === "unplayable" ? `不可奏：${item.reason ?? "原因未说明"}` : item.status === "rest" ? "休止" : "可演奏"} · ${pitch}`;
      if (item.status === "unplayable") unplayable += 1;
      if (item.status === "ambiguous") ambiguous += 1;
      sequenceView.append(row);
    });
    const noteCount = importedSequence.events.filter((event) => event.kind === "note").length;
    summaryText.textContent = `导入 ${noteCount} 个音符 / 不可奏 ${unplayable} / 同音候选 ${ambiguous}${importedSequence.timeBase === "unmetered" ? " · 节奏未知，当前不做节奏评分" : ""}`;
  }

  demo.onclick = () => {
    textarea.value = "4B 4D 5B";
    originalKey.value = "C";
    transpose.value = "0";
    invalidate();
    summaryText.textContent = "已填入 C 琴演示片段，请点击“生成预览”。";
  };
  textarea.oninput = invalidate;
  originalKey.onchange = invalidate;
  targetKey.onchange = renderPlan;
  transpose.onchange = renderPlan;
  transpose.onblur = renderPlan;
  exportButton.onclick = () => {
    if (sequence && previewValid) downloadSequence(sequence);
  };
  generate.onclick = () => {
    const result = importBdText(textarea.value, {
      sourceKey: originalKey.value ? (originalKey.value as Key) : null,
      title: "BD 导入歌曲",
    });
    showDiagnostics(result.diagnostics);
    sequence = result.sequence;
    previewValid = Boolean(sequence);
    exportButton.disabled = !previewValid;
    if (sequence) renderPlan();
    else {
      summaryText.textContent = "导入未完成，请根据诊断修正谱文。";
      sequenceView.replaceChildren();
      lyricsView.replaceChildren();
      lyricsDetails.hidden = true;
    }
  };
  container.replaceChildren(details);
}
