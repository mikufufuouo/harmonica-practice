import { validateNoteSequence, type NoteSequence } from "./score/index.ts";
import {
  melodyEligibility,
  optimizeSoloPath,
  soloCandidates,
} from "./score/jianpu.ts";
import { saveChromaticSequence } from "./score-library.ts";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  return n;
};
export function mountChromaticImport(root: HTMLElement): void {
  const section = el("details");
  section.className = "score-import panel";
  section.append(el("summary", "标准音符谱 → 12 孔半音阶 BD（Agent 找谱）"));
  const hint = el(
    "p",
    "导入经过核实的 NoteSequence JSON。此页不识别图片；请核对来源、音符和指法后再保存。孔位采用 KB-12 C 调标准 Solo 暂定表：请先核对 1B=C4、1D=D4。若你的琴是 Orchestral 调音，此表不适用。",
  );
  hint.className = "hint";
  const pick = el("input") as HTMLInputElement;
  pick.type = "file";
  pick.accept = ".json,application/json";
  const ack = el("input") as HTMLInputElement;
  ack.type = "checkbox";
  const octave = el("select");
  octave.setAttribute("aria-label", "演奏八度偏移");
  octave.append(new Option("原八度（0）", "0"), new Option("升高八度（+12 半音）", "12"));
  const review = el("input") as HTMLInputElement;
  review.type = "checkbox";
  const status = el("p");
  status.setAttribute("role", "status");
  const source = el("div"),
    rows = el("ol");
  rows.className = "score-sequence";
  const save = el("button", "确认并保存到本机曲库") as HTMLButtonElement;
  save.className = "primary";
  save.disabled = true;
  const labelBox = (title: string, input: HTMLElement) => {
    const label = el("label", title);
    label.append(input);
    return label;
  };
  section.append(
    hint,
    pick,
    labelBox("我确认琴为 C 调 KB-12 标准 Solo，且核对 1B=C4、1D=D4", ack),
    labelBox("演奏时移八度（原始音符音高保持不变）", octave),
    source,
    rows,
    labelBox("我已核对来源、每个音符及整段指法", review),
    save,
    status,
  );
  root.append(section);
  let sequence: NoteSequence | null = null,
    overrides: Record<string, { midi: number; label: string }> = {},
    pins: Record<number, string> = {},
    saving = false;
  const invalidate = () => {
    sequence = null;
    overrides = {};
    pins = {};
    review.checked = false;
    rows.replaceChildren();
    source.replaceChildren();
    save.disabled = true;
  };
  const render = () => {
    rows.replaceChildren();
    if (!sequence) return;
    const notes = sequence.events.filter((e) => e.kind === "note");
    const octaveShift = Number(octave.value) as 0 | 12;
    const path = optimizeSoloPath(
      notes.map((e) => ({ midi: e.pitch.midi + octaveShift })),
      "C",
      pins,
    );
    let ni = 0;
    let unplayable = false;
    sequence.events.forEach((event) => {
      if (event.kind === "rest") {
        const before = sequence!.annotations.filter(
          (a) => a.beforeEventId === event.id && a.kind === "barline",
        ).length;
        if (before) rows.append(el("li", `| ${"小节线 ".repeat(before)}`));
        rows.append(
          el(
            "li",
            `${event.order + 1}. 休止${event.sourceRef?.token ? ` · 原文 ${event.sourceRef.token}` : ""}`,
          ),
        );
        return;
      }
      const i = ni++;
      const before = sequence!.annotations.filter(
        (a) => a.beforeEventId === event.id && a.kind === "barline",
      ).length;
      if (before) rows.append(el("li", `| ${"小节线 ".repeat(before)}`));
      const li = el(
        "li",
        `${event.order + 1}. ${event.pitch.spelling ?? pitchName(event.pitch.midi)} · MIDI `,
      );
      const pitchInput = el("input") as HTMLInputElement;
      pitchInput.type = "number";
      pitchInput.min = "0";
      pitchInput.max = "127";
      pitchInput.step = "1";
      pitchInput.value = String(event.pitch.midi);
      pitchInput.setAttribute("aria-label", `音符 ${i + 1} MIDI 音高`);
      pitchInput.onchange = () => {
        const midi = Number(pitchInput.value);
        if (!Number.isInteger(midi) || midi < 0 || midi > 127) {
          pitchInput.value = String(event.pitch.midi);
          status.textContent = "MIDI 音高必须是 0 到 127 的整数。";
          return;
        }
        if (midi !== event.pitch.midi) {
          event.pitch.midi = midi;
          event.pitch.spelling = undefined;
          event.confidence = undefined;
          sequence!.annotations = sequence!.annotations.filter(
            (a) => a.kind !== "text" || a.beforeEventId !== event.id,
          );
          sequence!.annotations.push({
            kind: "text",
            beforeEventId: event.id,
            text: "人工修正音高",
          });
          delete overrides[event.id];
          delete pins[i];
          review.checked = false;
          render();
        }
      };
      const targetMidi = event.pitch.midi + octaveShift;
      li.append(pitchInput, el("span", ` · 演奏音高 ${pitchName(targetMidi)}（MIDI ${targetMidi}）· BD `));
      const choices = soloCandidates(targetMidi, "C");
      const select = el("select");
      select.setAttribute("aria-label", `音符 ${i + 1} 指法`);
      choices.forEach((c) => select.append(new Option(c.label, c.label)));
      const selected = path[i]?.label;
      if (selected) select.value = selected;
      select.onchange = () => {
        pins[i] = select.value;
        const c = choices.find((c) => c.label === select.value);
        if (c) overrides[event.id] = { midi: targetMidi, label: c.label };
        review.checked = false;
        render();
      };
      if (!choices.length) {
        unplayable = true;
        li.append(el("strong", "此音在该琴调暂不可奏"));
      } else li.append(select);
      if (event.sourceRef?.token || event.sourceRef?.line) {
        li.append(
          el(
            "small",
            `来源：${event.sourceRef.line ? `${event.sourceRef.line}行${event.sourceRef.column}列 ` : ""}${event.sourceRef.token ?? ""}`,
          ),
        );
      }
      if (event.confidence !== undefined)
        li.append(
          el(
            "small",
            `识谱证据 ${event.confidence.toFixed(2)}${event.confidence < 0.8 ? " · 低证据，请重点核对" : ""}（不是正确率）`,
          ),
        );
      rows.append(li);
    });
    save.disabled = !(review.checked && ack.checked && !unplayable);
  };
  pick.onchange = async () => {
    invalidate();
    const file = pick.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      status.textContent = "JSON 文件超过 5 MiB 限制。";
      return;
    }
    try {
      const value = JSON.parse(await file.text()) as unknown;
      const checked = validateNoteSequence(value);
      if (!checked.valid) {
        status.textContent = `拒绝导入：${checked.errors.join("；")}`;
        return;
      }
      sequence = value as NoteSequence;
      const eligible = melodyEligibility(sequence);
      if (eligible.length) {
        status.textContent = `拒绝导入：${eligible.join("；")}`;
        sequence = null;
        return;
      }
      source.replaceChildren(
        el("h3", sequence.title),
        ...sequence.sources.map((s) => {
          const p = el("p");
          p.textContent = `${s.format}${s.description ? ` · ${s.description}` : ""}`;
          if (s.url) {
            try {
              const u = new URL(s.url);
              if (["http:", "https:"].includes(u.protocol)) {
                const a = el("a", u.href);
                a.href = u.href;
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                p.append(a);
              }
            } catch {}
          }
          const fragment = document.createDocumentFragment();
          fragment.append(p);
          if (s.rawText) {
            const raw = el("details");
            raw.className = "score-source-raw";
            raw.append(el("summary", "查看原始谱文"));
            const pre = el("pre", s.rawText);
            pre.className = "score-source-pre";
            raw.append(pre);
            fragment.append(raw);
          }
          return fragment;
        }),
      );
      status.textContent = `已校验 ${sequence.events.length} 个事件。节奏字段按原谱保留；本工具仅转换音高。`;
      render();
    } catch (e) {
      status.textContent = `读取失败：${e instanceof Error ? e.message : "JSON 无效"}`;
    }
  };
  ack.onchange = review.onchange = () => render();
  octave.onchange = () => {
    overrides = {};
    pins = {};
    review.checked = false;
    status.textContent = "演奏八度已更改；旧指法选择已清除，请重新检查指法。";
    render();
  };
  save.onclick = async () => {
    if (!sequence || !ack.checked || !review.checked || saving) return;
    saving = true;
    save.disabled = true;
    try {
      const entry = await saveChromaticSequence(
        sequence,
        { model: "kb12-solo-assumed", key: "C", octaveShift: Number(octave.value) as 0 | 12 },
        overrides,
      );
      document.dispatchEvent(new Event("score-library-changed"));
      status.textContent = `已保存《${entry.title}》。曲库中可打开查看 BD。`;
    } catch (e) {
      status.textContent = `保存失败：${e instanceof Error ? e.message : "未知错误"}`;
    } finally {
      saving = false;
      render();
    }
  };
}

function pitchName(midi: number): string {
  const names = [
    "C",
    "C♯",
    "D",
    "D♯",
    "E",
    "F",
    "F♯",
    "G",
    "G♯",
    "A",
    "A♯",
    "B",
  ];
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`;
}
