import type { NoteSequence } from "./types.ts";
import { validateNoteSequence } from "./validate.ts";

export type JianpuResult = { sequence: NoteSequence | null; errors: string[] };
export function melodyEligibility(sequence: NoteSequence): string[] {
  const errors: string[] = [];
  const notes = sequence.events.filter((event) => event.kind === "note");
  if (!notes.length) errors.push("曲谱没有音符。");
  if (
    new Set(sequence.events.map((event) => event.trackId)).size > 1 ||
    new Set(sequence.events.map((event) => event.voiceId)).size > 1
  )
    errors.push("此导入器只接受单轨、单声部旋律。");
  if (
    sequence.timeBase === "unmetered" &&
    new Set(sequence.events.map((event) => event.order)).size !==
      sequence.events.length
  )
    errors.push(
      "未知节奏谱中出现重复顺序，可能包含同时音符；已拒绝多声部内容。",
    );
  if (sequence.timeBase !== "unmetered") {
    const timed = sequence.events.map((event) => {
      const time = event.time!;
      const start =
        time.unit === "quarter"
          ? time.start.numerator / time.start.denominator
          : time.start;
      const duration =
        time.duration === null
          ? null
          : time.unit === "quarter"
            ? time.duration.numerator / time.duration.denominator
            : time.duration;
      return { start, end: duration === null ? null : start + duration };
    });
    timed.sort((a, b) => a.start - b.start);
    let lastStart = -Infinity;
    let latestEnd = -Infinity;
    for (const event of timed) {
      if (event.start === lastStart || event.start < latestEnd) {
        errors.push("检测到同时或重叠事件；此导入器不接受和弦/复调。");
        break;
      }
      lastStart = event.start;
      if (event.end !== null) latestEnd = Math.max(latestEnd, event.end);
    }
  }
  return [...new Set(errors)];
}
const pitchClass = [0, 2, 4, 5, 7, 9, 11];

/** Strict unmetered single-voice jianpu subset. 1=C4; apostrophe raises octave, dot lowers. */
export function parseJianpu(
  text: string,
  options: { title: string },
): JianpuResult {
  const errors: string[] = [];
  const match = /^\s*1\s*=\s*([A-Ga-g])([#b♯♭]?)\s*(?:\n|$)/.exec(text);
  if (!match)
    return { sequence: null, errors: ["首行必须明确写出调号，例如 1=C。"] };
  const natural: Record<string, number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
  };
  const tonic =
    (natural[match[1].toUpperCase()] +
      (match[2] === "#" || match[2] === "♯"
        ? 1
        : match[2] === "b" || match[2] === "♭"
          ? -1
          : 0) +
      12) %
    12;
  const sourceId = "jianpu-source-1";
  const events: NoteSequence["events"] = [];
  const annotations: NoteSequence["annotations"] = [];
  let accidental: number | null = null,
    order = 0;
  const body = text.slice(match[0].length);
  let i = 0;
  while (i < body.length) {
    const c = body[i]!;
    if (/\s|[,，、;]/.test(c)) {
      i++;
      continue;
    }
    if (c === "|" || c === "｜") {
      if (accidental !== null)
        errors.push(`第 ${i + 1} 字：升降号后缺少音符。`);
      annotations.push({
        kind: "barline",
        beforeEventId: `event-${order + 1}`,
      });
      accidental = null;
      i++;
      continue;
    }
    if (c === "#" || c === "♯" || c === "b" || c === "♭") {
      if (accidental !== null) errors.push(`第 ${i + 1} 字：重复临时升降号。`);
      accidental = c === "#" || c === "♯" ? 1 : -1;
      i++;
      continue;
    }
    if (c === "′" || c === "'" || c === "˙" || c === ".") {
      errors.push(`第 ${i + 1} 字：八度标记应紧跟音符数字。`);
      i++;
      continue;
    }
    if (c === "0") {
      errors.push(`第 ${i + 1} 字：休止符暂不支持；请先只导入单旋律音符。`);
      i++;
      continue;
    }
    if (/[1-7]/.test(c)) {
      const degree = Number(c) - 1;
      let octave = 0;
      while (
        body[i + 1] === "′" ||
        body[i + 1] === "'" ||
        body[i + 1] === "˙" ||
        body[i + 1] === "."
      ) {
        octave += body[i + 1] === "′" || body[i + 1] === "'" ? 1 : -1;
        i++;
      }
      if (Math.abs(octave) > 3)
        errors.push(`第 ${i + 1} 字：单音八度标记超出支持范围。`);
      const midi =
        60 + tonic + pitchClass[degree] + octave * 12 + (accidental ?? 0);
      events.push({
        id: `event-${order + 1}`,
        trackId: "track-1",
        voiceId: "voice-1",
        order: order++,
        time: null,
        kind: "note",
        pitch: { midi, cents: 0 },
        sourceRef: {
          sourceId,
          token: `${accidental === 1 ? "♯" : accidental === -1 ? "♭" : ""}${c}`,
        },
      });
      accidental = null;
      i++;
      continue;
    }
    errors.push(`第 ${i + 1} 字：不支持的符号“${c}”。`);
    i++;
  }
  if (accidental !== null) errors.push("末尾升降号后缺少音符。");
  if (!events.length) errors.push("没有可解析的音符。");
  if (errors.length) return { sequence: null, errors };
  const eventIds = new Set(events.map((event) => event.id));
  for (const annotation of annotations)
    if (annotation.beforeEventId && !eventIds.has(annotation.beforeEventId))
      delete annotation.beforeEventId;
  const sequence: NoteSequence = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: options.title.trim() || "简谱导入",
    timeBase: "unmetered",
    tracks: [{ id: "track-1", name: "主旋律" }],
    events,
    tempoMap: [],
    meterMap: [],
    annotations,
    lyrics: [],
    sources: [{ id: sourceId, format: "jianpu", rawText: text }],
  };
  const checked = validateNoteSequence(sequence);
  return checked.valid
    ? { sequence, errors: [] }
    : { sequence: null, errors: checked.errors };
}

export type SoloCandidate = {
  hole: number;
  breath: "B" | "D";
  slide: boolean;
  label: string;
  midi: number;
};
export function soloCandidates(
  midi: number,
  harpKey: "C" = "C",
): SoloCandidate[] {
  if (harpKey !== "C") throw new Error("仅支持 C 调标准 Solo 配置。");
  const out: SoloCandidate[] = [];
  // Standard Solo pattern: each four-hole block repeats C E G C / D F A B.
  for (let hole = 1; hole <= 12; hole++) {
    const block = Math.floor((hole - 1) / 4),
      pos = (hole - 1) % 4;
    for (const breath of ["B", "D"] as const) {
      const semitone =
        breath === "B" ? [0, 4, 7, 12][pos]! : [2, 5, 9, 11][pos]!;
      const base = 60 + block * 12 + semitone;
      for (const slide of [false, true])
        if (base + (slide ? 1 : 0) === midi)
          out.push({
            hole,
            breath,
            slide,
            midi,
            label: `${hole}${breath}${slide ? "推键" : ""}`,
          });
    }
  }
  return out;
}

/** Global path minimizes hole travel, then breath/slide changes; candidate enumeration order is not a preference. */
export function optimizeSoloPath(
  notes: { midi: number }[],
  harpKey: "C" = "C",
  pins: Record<number, string> = {},
): (SoloCandidate | null)[] {
  if (!notes.length) return [];
  const allLayers = notes.map((n) => soloCandidates(n.midi, harpKey));
  const result: (SoloCandidate | null)[] = Array(notes.length).fill(null);
  let start = 0;
  while (start < notes.length) {
    while (start < notes.length && !allLayers[start]!.length) start++;
    if (start >= notes.length) break;
    let end = start;
    while (end < notes.length && allLayers[end]!.length) end++;
    const layers = allLayers.slice(start, end).map((candidates, i) => {
      const pin = pins[start + i];
      return pin ? candidates.filter((c) => c.label === pin) : candidates;
    });
    if (!layers.every((layer) => layer.length)) {
      // Ignore stale pins for this passage and recompute a valid continuous route.
      layers.splice(0, layers.length, ...allLayers.slice(start, end));
    }
    if (layers.every((layer) => layer.length)) {
      let costs = layers[0]!.map(() => 0);
      const parents: number[][] = [];
      for (let i = 1; i < layers.length; i++) {
        const prev = layers[i - 1]!,
          current = layers[i]!;
        const next = current.map((c) =>
          Math.min(
            ...prev.map(
              (p, j) =>
                costs[j]! +
                Math.abs(c.hole - p.hole) * 3 +
                (c.breath === p.breath ? 0 : 2) +
                (c.slide === p.slide ? 0 : 1),
            ),
          ),
        );
        parents.push(
          current.map((c) => {
            let best = 0,
              score = Infinity;
            prev.forEach((p, j) => {
              const s =
                costs[j]! +
                Math.abs(c.hole - p.hole) * 3 +
                (c.breath === p.breath ? 0 : 2) +
                (c.slide === p.slide ? 0 : 1);
              if (s < score) {
                score = s;
                best = j;
              }
            });
            return best;
          }),
        );
        costs = next;
      }
      let index = costs.indexOf(Math.min(...costs));
      const path: SoloCandidate[] = Array(notes.length);
      for (let i = end - start - 1; i >= 0; i--) {
        path[i] = layers[i]![index]!;
        if (i) index = parents[i - 1]![index]!;
      }
      path.forEach((candidate, i) => (result[start + i] = candidate));
    } else {
      // Invalid pin cannot erase a playable note; fall back to the unpinned local candidates.
      for (let i = start; i < end; i++) result[i] = allLayers[i]![0]!;
    }
    start = end;
  }
  return result;
}
