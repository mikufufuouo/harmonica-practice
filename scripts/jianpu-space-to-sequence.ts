import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { NoteSequence, Fraction } from "../src/score/types.ts";
import { validateNoteSequence } from "../src/score/validate.ts";

type Diagnostic = {
  line: number;
  column: number;
  token: string;
  message: string;
};
type ParseResult = { sequence: NoteSequence | null; errors: Diagnostic[] };

const degreeSemitones = [0, 2, 4, 5, 7, 9, 11];
const naturalPitchClass: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}
function fraction(numerator: number, denominator: number): Fraction {
  const divisor = gcd(Math.abs(numerator), denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}
function add(a: Fraction, b: Fraction): Fraction {
  return fraction(
    a.numerator * b.denominator + b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
}
function accidentalOffset(mark: string): number {
  if (mark === "#") return 1;
  if (mark === "##") return 2;
  if (mark === "b") return -1;
  if (mark === "bb") return -2;
  return 0;
}

/**
 * Parses the documented notation behavior in jianpu.space's public je.js.
 * It intentionally rejects syntax the site renderer accepts but whose musical
 * meaning this adapter cannot preserve.
 */
export function parseJianpuSpace(
  text: string,
  options: { title?: string; sourceUrl?: string } = {},
): ParseResult {
  const errors: Diagnostic[] = [];
  const fail = (line: number, column: number, token: string, message: string) =>
    errors.push({ line, column, token, message });
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const sourceId = "jianpu-space-source";
  const events: NoteSequence["events"] = [];
  const annotations: NoteSequence["annotations"] = [];
  const tempoMap: NoteSequence["tempoMap"] = [];
  let tonicOffset: number | null = null;
  let currentTime: Fraction = { numerator: 0, denominator: 1 };
  let order = 0;
  let barlinePending = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!;
    const lineNumber = lineIndex + 1;
    if (!line.trim() || line.startsWith("L:")) continue;

    const bpmLine = /^ｂｐｍ\s*(\d+(?:\.\d+)?)\s*$/.exec(line);
    if (bpmLine) {
      const bpm = Number(bpmLine[1]);
      if (bpm < 20 || bpm > 500) {
        fail(
          lineNumber,
          1,
          line,
          "jianpu.space BPM must be between 20 and 500.",
        );
      } else {
        const at = { ...currentTime };
        const previous = tempoMap.at(-1);
        if (
          previous &&
          previous.at.numerator * at.denominator ===
            at.numerator * previous.at.denominator
        )
          tempoMap[tempoMap.length - 1] = { at, bpm };
        else tempoMap.push({ at, bpm });
      }
      continue;
    }

    let i = 0;
    while (i < line.length) {
      if (/\s/.test(line[i]!)) {
        i++;
        continue;
      }
      if (line.startsWith("/key(", i)) {
        const match = /^\/key\(([A-Ga-g])([#b]?)([0-9]?)\)/.exec(line.slice(i));
        if (!match) {
          fail(
            lineNumber,
            i + 1,
            line.slice(i),
            "Malformed /key(...) directive.",
          );
          break;
        }
        if (tonicOffset !== null || events.length) {
          fail(
            lineNumber,
            i + 1,
            match[0],
            "Only one /key(...) at the beginning of the score is supported.",
          );
          i += match[0].length;
          continue;
        }
        const letter = match[1]!.toUpperCase();
        const defaultOctave = /[GAB]/.test(letter) ? 3 : 4;
        const octave = match[3] ? Number(match[3]) : defaultOctave;
        const accidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
        tonicOffset =
          naturalPitchClass[letter]! + accidental + (octave - 4) * 12;
        i += match[0].length;
        continue;
      }
      if (line[i] === "|") {
        const token = line[i] === "|" && line[i + 1] === "|" ? "||" : "|";
        annotations.push({
          kind: "barline",
          ...(events.length ? { beforeEventId: `event-${order + 1}` } : {}),
        });
        barlinePending = true;
        i += token.length;
        continue;
      }
      if (line[i] === "#" || line[i] === "b" || line[i] === "n") {
        const start = i;
        let mark = line[i++]!;
        if ((mark === "#" || mark === "b") && line[i] === mark)
          mark += line[i++]!;
        const digit = line[i];
        if (digit === undefined || !/[0-7]/.test(digit)) {
          fail(
            lineNumber,
            start + 1,
            line.slice(start, i),
            "Accidental must immediately precede one digit 0–7.",
          );
          continue;
        }
        if (digit === "0") {
          fail(
            lineNumber,
            start + 1,
            line.slice(start, i + 1),
            "Accidentals on a rest are unsupported.",
          );
          i++;
          continue;
        }
        if (tonicOffset === null) {
          fail(
            lineNumber,
            start + 1,
            line.slice(start, i + 1),
            "A /key(...) directive is required before notes.",
          );
          i++;
          continue;
        }
        const parsed = parseNoteSuffix(line, i + 1, lineNumber, fail);
        i = parsed.next;
        const midi =
          60 +
          tonicOffset +
          degreeSemitones[Number(digit) - 1]! +
          (mark === "n" ? 0 : accidentalOffset(mark)) +
          parsed.octave * 12;
        appendEvent(
          "note",
          midi,
          start,
          lineNumber,
          line.slice(start, i),
          parsed.duration,
        );
        barlinePending = false;
        continue;
      }
      if (/[0-7]/.test(line[i]!)) {
        const start = i;
        const digit = line[i++]!;
        const parsed = parseNoteSuffix(line, i, lineNumber, fail);
        i = parsed.next;
        if (digit !== "0" && tonicOffset === null) {
          fail(
            lineNumber,
            start + 1,
            line.slice(start, i),
            "A /key(...) directive is required before notes.",
          );
          continue;
        }
        if (digit === "0")
          appendEvent(
            "rest",
            undefined,
            start,
            lineNumber,
            line.slice(start, i),
            parsed.duration,
          );
        else {
          const midi =
            60 +
            tonicOffset! +
            degreeSemitones[Number(digit) - 1]! +
            parsed.octave * 12;
          appendEvent(
            "note",
            midi,
            start,
            lineNumber,
            line.slice(start, i),
            parsed.duration,
          );
        }
        barlinePending = false;
        continue;
      }
      if (line[i] === "-") {
        const start = i++;
        const parsed = parseNoteSuffix(line, i, lineNumber, fail);
        i = parsed.next;
        const previous = events.at(-1);
        if (!previous) {
          appendEvent(
            "rest",
            undefined,
            start,
            lineNumber,
            line.slice(start, i),
            parsed.duration,
          );
        } else if (barlinePending) {
          const tieGroupId = previous.tieGroupId ?? `tie-${previous.id}`;
          previous.tieGroupId = tieGroupId;
          const id = `event-${order + 1}`;
          const sourceRef = {
            sourceId,
            line: lineNumber,
            column: start + 1,
            token: line.slice(start, i),
          };
          events.push(
            previous.kind === "note"
              ? {
                  id,
                  trackId: "track-1",
                  voiceId: "voice-1",
                  order,
                  time: {
                    unit: "quarter",
                    start: { ...currentTime },
                    duration: parsed.duration,
                  },
                  kind: "note",
                  pitch: { ...previous.pitch },
                  tieGroupId,
                  sourceRef,
                }
              : {
                  id,
                  trackId: "track-1",
                  voiceId: "voice-1",
                  order,
                  time: {
                    unit: "quarter",
                    start: { ...currentTime },
                    duration: parsed.duration,
                  },
                  kind: "rest",
                  tieGroupId,
                  sourceRef,
                },
          );
          order++;
          currentTime = add(currentTime, parsed.duration);
        } else {
          const previousTime = previous.time;
          if (
            !previousTime ||
            previousTime.unit !== "quarter" ||
            previousTime.duration === null
          ) {
            fail(
              lineNumber,
              start + 1,
              line.slice(start, i),
              "Cannot tie from an event without a known quarter-note duration.",
            );
            continue;
          }
          previousTime.duration = add(previousTime.duration, parsed.duration);
          annotations.push({
            kind: "text",
            beforeEventId: previous.id,
            text: `jianpu.space tie continuation ${line.slice(start, i)} at ${lineNumber}:${start + 1}`,
          });
          currentTime = add(currentTime, parsed.duration);
        }
        barlinePending = false;
        continue;
      }
      if (
        line[i] === "'" ||
        line[i] === "," ||
        line[i] === "_" ||
        line[i] === "=" ||
        line[i] === "."
      ) {
        const start = i++;
        fail(
          lineNumber,
          start + 1,
          line[start]!,
          "Orphan octave/rhythm marker without a preceding note.",
        );
        continue;
      }
      const start = i++;
      fail(
        lineNumber,
        start + 1,
        line[start]!,
        "Unsupported jianpu.space symbol; no partial sequence will be emitted.",
      );
    }
  }

  if (tonicOffset === null) fail(1, 1, "", "Missing /key(...) directive.");
  if (!events.length) fail(1, 1, "", "No events were parsed.");
  if (errors.length) return { sequence: null, errors };

  const eventIds = new Set(events.map((event) => event.id));
  for (const annotation of annotations)
    if (annotation.beforeEventId && !eventIds.has(annotation.beforeEventId))
      delete annotation.beforeEventId;

  const sequence: NoteSequence = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: options.title?.trim() || "简谱导入",
    timeBase: "quarter",
    tracks: [{ id: "track-1", name: "主旋律" }],
    events,
    tempoMap,
    meterMap: [],
    annotations,
    lyrics: [],
    sources: [
      {
        id: sourceId,
        format: "jianpu",
        description:
          "Parsed from jianpu.space notation; lyrics have no note alignment. Melody still requires human review.",
        ...(options.sourceUrl ? { url: options.sourceUrl } : {}),
        rawText: text,
      },
    ],
  };
  const validation = validateNoteSequence(sequence);
  if (!validation.valid) {
    for (const message of validation.errors)
      fail(1, 1, "", `NoteSequence validation failed: ${message}`);
    return { sequence: null, errors };
  }
  return { sequence, errors: [] };

  function appendEvent(
    kind: "note" | "rest",
    midi: number | undefined,
    columnIndex: number,
    line: number,
    token: string,
    duration: Fraction,
  ) {
    const id = `event-${order + 1}`;
    const sourceRef = { sourceId, line, column: columnIndex + 1, token };
    events.push(
      kind === "note"
        ? {
            id,
            trackId: "track-1",
            voiceId: "voice-1",
            order,
            time: { unit: "quarter", start: { ...currentTime }, duration },
            kind,
            pitch: { midi: midi!, cents: 0 },
            sourceRef,
          }
        : {
            id,
            trackId: "track-1",
            voiceId: "voice-1",
            order,
            time: { unit: "quarter", start: { ...currentTime }, duration },
            kind,
            sourceRef,
          },
    );
    order++;
    currentTime = add(currentTime, duration);
  }
}

function parseNoteSuffix(
  line: string,
  start: number,
  lineNumber: number,
  fail: (line: number, column: number, token: string, message: string) => void,
): { octave: number; duration: Fraction; next: number } {
  let i = start;
  let octave = 0;
  while (line[i] === "'" || line[i] === ",") {
    octave += line[i] === "'" ? 1 : -1;
    i++;
  }
  let type = 0;
  let multiplier = 1;
  if (line[i] === "-") {
    multiplier = 0;
    while (line[i] === "-") {
      multiplier++;
      i++;
    }
    multiplier++; // site's parser initializes mul=1 then increments for every dash
  } else {
    while (line[i] === "=") {
      type += 2;
      i++;
    }
    if (line[i] === "_") {
      type++;
      i++;
    }
  }
  let dots = 0;
  if (line[i] === ".") {
    dots = 1;
    i++;
    if (line[i] === ".") {
      dots = 2;
      i++;
    }
  }
  if (line[i] === "_" || line[i] === "=") {
    const startBad = i;
    while (line[i] === "_" || line[i] === "=") i++;
    fail(
      lineNumber,
      startBad + 1,
      line.slice(startBad, i),
      "Unsupported repeated/mixed subdivision marker according to jianpu.space parser semantics.",
    );
  }
  if (line[i] === ".") {
    const startBad = i;
    while (line[i] === ".") i++;
    fail(
      lineNumber,
      startBad + 1,
      line.slice(startBad, i),
      "The source parser supports at most two dots.",
    );
  }
  if (Math.abs(octave) > 3)
    fail(
      lineNumber,
      start + 1,
      line.slice(start, i),
      "Octave shift beyond three marks is unsupported.",
    );
  const numerator = multiplier * (dots === 0 ? 1 : dots === 1 ? 3 : 7);
  const denominator = 2 ** type * (dots === 2 ? 4 : dots === 1 ? 2 : 1);
  return { octave, duration: fraction(numerator, denominator), next: i };
}

async function main() {
  const args = process.argv.slice(2);
  const inputArg = args.shift();
  const outputArg = args.shift();
  let title: string | undefined;
  let sourceUrl: string | undefined;
  while (args.length) {
    const flag = args.shift();
    const value = args.shift();
    if (!value || (flag !== "--title" && flag !== "--source-url")) {
      console.error(
        "Usage: npx tsx scripts/jianpu-space-to-sequence.ts INPUT.txt OUTPUT.json [--title TITLE] [--source-url URL]",
      );
      process.exitCode = 2;
      return;
    }
    if (flag === "--title") title = value;
    else sourceUrl = value;
  }
  if (!inputArg || !outputArg) {
    console.error(
      "Usage: npx tsx scripts/jianpu-space-to-sequence.ts INPUT.txt OUTPUT.json [--title TITLE] [--source-url URL]",
    );
    process.exitCode = 2;
    return;
  }
  const input = resolve(inputArg);
  const output = resolve(outputArg);
  const text = await readFile(input, "utf8");
  const result = parseJianpuSpace(text, { title, sourceUrl });
  if (!result.sequence) {
    console.error(JSON.stringify(result.errors, null, 2));
    process.exitCode = 1;
    return;
  }
  await writeFile(
    output,
    `${JSON.stringify(result.sequence, null, 2)}\n`,
    "utf8",
  );
  console.log(`Wrote ${result.sequence.events.length} events to ${output}`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
