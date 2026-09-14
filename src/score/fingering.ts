import { midiFor, type Key } from "../lib/harmonica.ts";
import type {
  FingeringCandidate,
  FingeringPlan,
  NoteSequence,
} from "./types.ts";

export function generateFingeringPlan(
  sequence: NoteSequence,
  targetKey: Key,
  options: { transposeSemitones?: number } = {},
): FingeringPlan {
  const transposeSemitones = options.transposeSemitones ?? 0;
  const items = sequence.events.map((event) => {
    if (event.kind === "rest")
      return { eventId: event.id, status: "rest" as const, candidates: [] };
    if (event.pitch.cents !== 0)
      return {
        eventId: event.id,
        status: "unplayable" as const,
        candidates: [],
        reason: "微分音需要未支持的技巧。",
      };
    const desired = event.pitch.midi + transposeSemitones;
    if (!Number.isInteger(desired) || desired < 0 || desired > 127)
      return {
        eventId: event.id,
        status: "unplayable" as const,
        candidates: [],
        reason: "移调后的音高超出 MIDI 范围。",
      };
    const candidates: FingeringCandidate[] = [];
    for (let hole = 1; hole <= 10; hole += 1)
      for (const breath of ["B", "D"] as const)
        if (midiFor(targetKey, hole, breath) === desired)
          candidates.push({
            hole,
            breath,
            label: `${hole}${breath}`,
            technique: "natural",
          });
    if (!candidates.length)
      return {
        eventId: event.id,
        status: "unplayable" as const,
        candidates,
        reason: "目标音需要未支持技巧或超出自然音范围。",
      };
    const bdSource =
      event.sourceRef &&
      sequence.sources.find(
        (source) =>
          source.id === event.sourceRef?.sourceId && source.format === "bd",
      );
    const original = bdSource
      ? event.sourceRef?.token
          ?.replace(/[\s　]/g, "")
          .replace(/[０-９]/g, (digit) =>
            String.fromCharCode(digit.charCodeAt(0) - 0xfee0),
          )
          .replace(/[ＢＤｂｄ]/g, (letter) =>
            String.fromCharCode(letter.charCodeAt(0) - 0xfee0),
          )
          .toUpperCase()
      : undefined;
    const preferred = candidates.find(
      (candidate) => candidate.label === original,
    );
    return {
      eventId: event.id,
      status:
        candidates.length === 1 ? ("mapped" as const) : ("ambiguous" as const),
      candidates,
      ...(preferred ? { preferred } : {}),
    };
  });
  return { targetKey, transposeSemitones, items };
}
