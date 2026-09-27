import type { NoteSequence, SequenceEvent } from "./score/types.ts";
import { optimizeSoloPath, soloCandidates } from "./score/jianpu.ts";

export type PracticeItem = {
  eventId: string;
  kind: "note" | "rest";
  label?: string;
  attack: boolean;
  tieContinuation: boolean;
  tieGroupId?: string;
  durationQuarter: number | null;
  durationSeconds: number | null;
  durationText: string;
  timingUnknown: boolean;
  barlineBefore: boolean;
  lineBreakBefore: boolean;
};
export type PracticeProjection = {
  items: PracticeItem[];
  tieOverrideConflicts: string[];
  timingDescription: string;
  meterDescription: string;
  tempoDescription: string;
};
export type PracticeLayoutItem = PracticeItem;
export type PracticeRow = {
  items: Array<{
    item: PracticeLayoutItem;
    width: number;
    durationWidth: number;
  }>;
};

type Options = {
  octaveShift?: 0 | 12;
  overrides?: Record<string, { midi: number; label: string }>;
  pins?: Record<number, string>;
};

function frac(value: { numerator: number; denominator: number }): number {
  return value.denominator ? value.numerator / value.denominator : 0;
}
function fractionLabel(value: {
  numerator: number;
  denominator: number;
}): string {
  if (value.denominator === 1) return `${value.numerator}♩`;
  if (value.numerator === 1 && value.denominator === 2) return "½♩";
  if (value.numerator === 1 && value.denominator === 4) return "¼♩";
  return `${value.numerator}/${value.denominator}♩`;
}
function validLabel(midi: number, label: string | undefined): label is string {
  return Boolean(
    label &&
    soloCandidates(midi, "C").some((candidate) => candidate.label === label),
  );
}
function displayLabel(label: string): string {
  return label.replace("推键", "#");
}

export function tiedEventIds(
  sequence: NoteSequence,
  eventId: string,
): string[] {
  const event = sequence.events.find((item) => item.id === eventId);
  if (!event?.tieGroupId || event.kind !== "note") return [eventId];
  return sequence.events
    .filter(
      (item) =>
        item.kind === "note" &&
        item.tieGroupId === event.tieGroupId &&
        item.pitch.midi === event.pitch.midi,
    )
    .map((item) => item.id);
}

function logicalNoteGroups(
  events: SequenceEvent[],
  octaveShift: number,
): Array<{
  indices: number[];
  midi: number;
  tieGroupId?: string;
}> {
  const groups: Array<{
    indices: number[];
    midi: number;
    tieGroupId?: string;
  }> = [];
  events.forEach((event, index) => {
    if (event.kind !== "note") return;
    const midi = event.pitch.midi + octaveShift;
    const previous = groups.at(-1);
    if (
      event.tieGroupId &&
      previous?.tieGroupId === event.tieGroupId &&
      previous.midi === midi &&
      previous.indices.at(-1) === index - 1
    )
      previous.indices.push(index);
    else
      groups.push({
        indices: [index],
        midi,
        ...(event.tieGroupId ? { tieGroupId: event.tieGroupId } : {}),
      });
  });
  return groups;
}

export function buildPracticeProjection(
  sequence: NoteSequence,
  options: Options = {},
): PracticeProjection {
  const octaveShift = options.octaveShift ?? 0;
  const groups = logicalNoteGroups(sequence.events, octaveShift);
  const groupForIndex = new Map<number, (typeof groups)[number]>();
  groups.forEach((group) =>
    group.indices.forEach((index) => groupForIndex.set(index, group)),
  );
  const noteIndices = sequence.events.flatMap((event, index) =>
    event.kind === "note" ? [index] : [],
  );
  const localNoteIndex = new Map(
    noteIndices.map((index, noteIndex) => [index, noteIndex]),
  );
  const canonicalPins: Record<number, string> = {};
  const tieOverrideConflicts: string[] = [];
  for (const group of groups) {
    const validOverrides = group.indices.flatMap((index) => {
      const event = sequence.events[index]!;
      if (event.kind !== "note") return [];
      const saved = options.overrides?.[event.id];
      return saved?.midi === group.midi && validLabel(group.midi, saved.label)
        ? [{ index, label: saved.label }]
        : [];
    });
    const labels = new Set(validOverrides.map((value) => value.label));
    if (group.tieGroupId && labels.size > 1)
      tieOverrideConflicts.push(group.tieGroupId);
    const explicitPin = group.indices.flatMap((index) => {
      const noteIndex = localNoteIndex.get(index);
      const label =
        noteIndex === undefined ? undefined : options.pins?.[noteIndex];
      return validLabel(group.midi, label) ? [{ index, label }] : [];
    });
    const chosen = validOverrides[0]?.label ?? explicitPin[0]?.label;
    if (chosen) {
      const firstNoteIndex = localNoteIndex.get(group.indices[0]!);
      if (firstNoteIndex !== undefined) canonicalPins[firstNoteIndex] = chosen;
    }
  }
  const path = optimizeSoloPath(
    groups.map((group) => ({ midi: group.midi })),
    "C",
    Object.fromEntries(
      groups.flatMap((group, groupIndex) => {
        const index = group.indices[0]!;
        const pin = canonicalPins[localNoteIndex.get(index)!];
        return pin ? [[groupIndex, pin]] : [];
      }),
    ),
  );
  const selectedByEvent = new Map<string, string>();
  groups.forEach((group, groupIndex) => {
    const label = path[groupIndex]?.label;
    if (!label) return;
    group.indices.forEach((index) =>
      selectedByEvent.set(sequence.events[index]!.id, displayLabel(label)),
    );
  });

  const annotationKinds = new Map<string, Set<string>>();
  sequence.annotations.forEach((annotation) => {
    if (!annotation.beforeEventId) return;
    const kinds =
      annotationKinds.get(annotation.beforeEventId) ?? new Set<string>();
    kinds.add(annotation.kind);
    annotationKinds.set(annotation.beforeEventId, kinds);
  });
  const firstQuarter =
    sequence.timeBase === "quarter" ? sequence.meterMap[0] : undefined;
  const meterDescription = firstQuarter
    ? `拍号 ${firstQuarter.beats}/${firstQuarter.beatType}`
    : "";
  const tempoDescription =
    sequence.timeBase === "quarter" && sequence.tempoMap[0]
      ? `${sequence.tempoMap[0].bpm} BPM`
      : "";
  const items: PracticeItem[] = sequence.events.map((event, index) => {
    const time = event.time;
    const durationQuarter =
      time?.unit === "quarter" && time.duration ? frac(time.duration) : null;
    const durationSeconds =
      time?.unit === "second" && time.duration !== null ? time.duration : null;
    const timingUnknown =
      !time ||
      (time.unit === "quarter" && time.duration === null) ||
      (time.unit === "second" && time.duration === null);
    const durationText =
      time?.unit === "quarter" && time.duration
        ? fractionLabel(time.duration)
        : durationSeconds !== null
          ? `${Number(durationSeconds.toFixed(2))}秒`
          : "节奏未知";
    const annotation = annotationKinds.get(event.id);
    const group = groupForIndex.get(index);
    const groupPosition = group?.indices.indexOf(index) ?? 0;
    return {
      eventId: event.id,
      kind: event.kind,
      ...(event.kind === "note" && selectedByEvent.has(event.id)
        ? { label: selectedByEvent.get(event.id)! }
        : {}),
      attack: !group || groupPosition === 0,
      tieContinuation: Boolean(group?.tieGroupId && groupPosition > 0),
      ...(group?.tieGroupId ? { tieGroupId: group.tieGroupId } : {}),
      durationQuarter,
      durationSeconds,
      durationText,
      timingUnknown,
      barlineBefore: annotation?.has("barline") ?? false,
      lineBreakBefore: annotation?.has("line-break") ?? false,
    };
  });
  const inferredBars =
    sequence.meterMap.length > 0 &&
    !sequence.annotations.some((annotation) => annotation.kind === "barline");
  const timingDescription =
    sequence.timeBase === "unmetered"
      ? "节奏未知：等距显示，不代表原谱拍点"
      : sequence.timeBase === "second"
        ? "按秒时长显示，不推算拍号"
        : `按相对四分音符时值显示${inferredBars ? " · 小节线按拍号推测" : ""}`;
  return {
    items,
    tieOverrideConflicts,
    timingDescription,
    meterDescription,
    tempoDescription,
  };
}

function explicitQuarterBarlines(sequence: NoteSequence): Set<string> {
  const ids = new Set(
    sequence.annotations
      .filter(
        (annotation) =>
          annotation.kind === "barline" && annotation.beforeEventId,
      )
      .map((annotation) => annotation.beforeEventId!),
  );
  if (ids.size) return ids;
  const meters = sequence.meterMap;
  if (!meters.length) return ids;
  for (const event of sequence.events) {
    if (event.time?.unit !== "quarter") continue;
    const start = frac(event.time.start);
    let active = meters[0]!;
    for (const meter of meters) {
      if (frac(meter.at) <= start) active = meter;
      else break;
    }
    const meterStart = frac(active.at);
    const barLength = (active.beats * 4) / active.beatType;
    const bars = (start - meterStart) / barLength;
    const meterChangedHere = meters.some(
      (meter) =>
        frac(meter.at) === start && frac(meter.at) > frac(meters[0]!.at),
    );
    if (
      meterChangedHere ||
      (start > meterStart && Math.abs(bars - Math.round(bars)) < 1e-7)
    )
      ids.add(event.id);
  }
  return ids;
}

export function layoutPracticeRows(
  items: PracticeLayoutItem[],
  availableWidth: number,
  sequence?: NoteSequence,
): PracticeRow[] {
  if (!items.length) return [];
  const width = Math.max(1, availableWidth);
  const barlines = sequence
    ? explicitQuarterBarlines(sequence)
    : new Set<string>();
  const normalized = items.map((item) => ({
    ...item,
    barlineBefore: item.barlineBefore || barlines.has(item.eventId),
  }));
  const positiveSeconds = normalized
    .flatMap((item) =>
      item.durationSeconds && item.durationSeconds > 0
        ? [item.durationSeconds]
        : [],
    )
    .sort((a, b) => a - b);
  const medianSeconds = positiveSeconds.length
    ? positiveSeconds[Math.floor(positiveSeconds.length / 2)]!
    : 1;
  const widths = normalized.map((item) => {
    const scaled =
      item.durationQuarter !== null
        ? item.durationQuarter * 38
        : item.durationSeconds !== null
          ? (item.durationSeconds / medianSeconds) * 38
          : 38;
    const minimum =
      item.kind === "rest"
        ? 36
        : Math.max(46, (item.label?.length ?? 3) * 11 + 12);
    const slot = Math.min(width, Math.max(minimum, scaled));
    const durationWidth = Math.min(
      slot,
      Math.max(
        12,
        item.durationQuarter !== null
          ? item.durationQuarter * 38
          : item.durationSeconds !== null
            ? (item.durationSeconds / medianSeconds) * 38
            : 38,
      ),
    );
    return { width: slot + (item.barlineBefore ? 13 : 0), durationWidth };
  });
  const rows: PracticeRow[] = [];
  let row: PracticeRow = { items: [] },
    used = 0;
  const flush = () => {
    if (row.items.length) rows.push(row);
    row = { items: [] };
    used = 0;
  };
  const append = (
    item: PracticeLayoutItem,
    itemWidth: number,
    durationWidth: number,
  ) => {
    const gap = row.items.length ? 8 : 0;
    if (used + gap + itemWidth > width && row.items.length) flush();
    const actualWidth = Math.min(width, itemWidth);
    row.items.push({
      item,
      width: actualWidth,
      durationWidth: Math.min(actualWidth, durationWidth),
    });
    used += (row.items.length > 1 ? 8 : 0) + actualWidth;
  };
  const effectiveWidth = (index: number) =>
    Math.min(width, widths[index]!.width);
  const partitionOversizedChunk = (start: number, end: number): number[][] => {
    const rangeWidth = (from: number, to: number) =>
      widths
        .slice(from, to)
        .reduce((sum, value) => sum + Math.min(width, value.width), 0) +
      Math.max(0, to - from - 1) * 8;
    const partitions: number[][] = [];
    let from = start;
    while (from < end) {
      let to = from + 1;
      while (to < end && rangeWidth(from, to + 1) <= width) to++;
      partitions.push(Array.from({ length: to - from }, (_, i) => from + i));
      from = to;
    }
    const tail = partitions.at(-1);
    const previous = partitions.at(-2);
    if (tail?.length === 1 && previous && previous.length > 2) {
      const pairStart = previous[0]!;
      const pairEnd = tail[0]! + 1;
      let best: { split: number; score: number } | undefined;
      for (let split = pairEnd - 2; split >= pairStart + 2; split--) {
        if (
          rangeWidth(pairStart, split) > width ||
          rangeWidth(split, pairEnd) > width
        )
          continue;
        const firstCount = split - pairStart;
        const secondCount = pairEnd - split;
        const score = Math.abs(firstCount - secondCount) * 100 - firstCount;
        if (!best || score < best.score) best = { split, score };
      }
      if (best) {
        partitions.splice(
          partitions.length - 2,
          2,
          Array.from(
            { length: best.split - pairStart },
            (_, i) => pairStart + i,
          ),
          Array.from(
            { length: pairEnd - best.split },
            (_, i) => best.split + i,
          ),
        );
      }
    }
    return partitions;
  };

  // A bar is kept together when possible. Long bars split only between events.
  let cursor = 0;
  while (cursor < normalized.length) {
    if (normalized[cursor]!.lineBreakBefore) flush();
    let end = cursor + 1;
    while (
      end < normalized.length &&
      !normalized[end]!.barlineBefore &&
      !normalized[end]!.lineBreakBefore
    )
      end++;
    const chunkWidth =
      widths.slice(cursor, end).reduce((sum, value) => sum + value.width, 0) +
      Math.max(0, end - cursor - 1) * 8;
    if (chunkWidth <= width) {
      if (row.items.length && used + 8 + chunkWidth > width) flush();
      for (let index = cursor; index < end; index++)
        append(
          normalized[index]!,
          widths[index]!.width,
          widths[index]!.durationWidth,
        );
    } else {
      if (row.items.length) flush();
      const partitions = partitionOversizedChunk(cursor, end);
      partitions.forEach((partition, partitionIndex) => {
        if (partitionIndex > 0) flush();
        for (const index of partition)
          append(
            normalized[index]!,
            effectiveWidth(index),
            widths[index]!.durationWidth,
          );
      });
    }
    cursor = end;
  }
  flush();
  return rows;
}

export function mountPracticeScore(
  container: HTMLElement,
  sequence: NoteSequence,
  projection: PracticeProjection,
): () => void {
  container.classList.add("practice-score");
  const header = document.createElement("p");
  header.className = "practice-score-meta";
  header.textContent = [
    projection.timingDescription,
    projection.meterDescription,
    projection.tempoDescription,
    projection.tieOverrideConflicts.length
      ? "连音组曾有指法冲突；按最早有效段显示，请在校对模式统一"
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const rowsHost = document.createElement("div");
  rowsHost.className = "practice-score-rows";
  container.replaceChildren(header, rowsHost);
  let lastWidth = 0;
  const draw = () => {
    const width = Math.floor(rowsHost.clientWidth);
    if (!width || width === lastWidth) return;
    lastWidth = width;
    const rows = layoutPracticeRows(projection.items, width, sequence);
    rowsHost.replaceChildren(
      ...rows.map((row) => {
        const line = document.createElement("div");
        line.className = "practice-score-row";
        line.style.gridTemplateColumns = row.items
          .map((slot) => `${slot.width}px`)
          .join(" ");
        row.items.forEach(({ item, durationWidth }) => {
          const cell = document.createElement("div");
          cell.className = `practice-score-cell ${item.kind === "rest" ? "is-rest" : "is-note"}${item.barlineBefore ? " has-barline" : ""}${item.tieContinuation ? " is-tie-continuation" : ""}`;
          cell.dataset.eventId = item.eventId;
          if (item.kind === "rest") {
            cell.append(document.createElement("span"));
            cell.firstElementChild!.className =
              "practice-score-glyph rest-glyph";
            cell.firstElementChild!.textContent = "休";
          } else if (item.tieContinuation) {
            const continuation = document.createElement("span");
            continuation.className = "practice-score-glyph tie-glyph";
            continuation.textContent = `↳ ${item.label ?? ""}`;
            continuation.setAttribute(
              "aria-label",
              `保持 ${item.label ?? "当前音符"}，延音续接，不重新吹奏`,
            );
            cell.append(continuation);
          } else {
            const glyph = document.createElement("span");
            glyph.className = "practice-score-glyph";
            glyph.textContent = item.label ?? "不可奏";
            cell.append(glyph);
          }
          const duration = document.createElement("small");
          duration.className = "practice-score-duration";
          duration.textContent = item.durationText;
          const durationLine = document.createElement("span");
          durationLine.className = "practice-score-duration-line";
          durationLine.style.width = `${durationWidth}px`;
          cell.append(durationLine, duration);
          line.append(cell);
        });
        return line;
      }),
    );
  };
  const observer = new ResizeObserver(draw);
  observer.observe(rowsHost);
  draw();
  return () => observer.disconnect();
}
