import assert from "node:assert/strict";
import test from "node:test";
import { validateNoteSequence } from "../src/score/index.ts";

const quarterSequence = () => ({
  schemaVersion: 1 as const, id: "quarter", title: "三连音", timeBase: "quarter" as const,
  tracks: [{ id: "main", name: "旋律" }, { id: "harmony", name: "和声" }],
  events: [
    { id: "n1", trackId: "main", voiceId: "v1", order: 0, time: { unit: "quarter" as const, start: { numerator: 0, denominator: 1 }, duration: { numerator: 1, denominator: 3 } }, kind: "note" as const, pitch: { midi: 60, cents: 0 }, tieGroupId: "tie-1" },
    { id: "n2", trackId: "main", voiceId: "v2", order: 1, time: { unit: "quarter" as const, start: { numerator: 0, denominator: 1 }, duration: { numerator: 1, denominator: 3 } }, kind: "note" as const, pitch: { midi: 64, cents: 0 } },
    { id: "n3", trackId: "main", voiceId: "v1", order: 2, time: { unit: "quarter" as const, start: { numerator: 1, denominator: 3 }, duration: { numerator: 1, denominator: 3 } }, kind: "note" as const, pitch: { midi: 60, cents: 0 }, tieGroupId: "tie-1" },
    { id: "r1", trackId: "main", voiceId: "v1", order: 3, time: { unit: "quarter" as const, start: { numerator: 2, denominator: 3 }, duration: { numerator: 1, denominator: 3 } }, kind: "rest" as const },
  ],
  tempoMap: [{ at: { numerator: 0, denominator: 1 }, bpm: 90 }], meterMap: [{ at: { numerator: 0, denominator: 1 }, beats: 3, beatType: 4 }],
  annotations: [{ kind: "text" as const, beforeEventId: "n1", text: "片段" }], lyrics: [], sources: [{ id: "native", format: "native" as const }],
});

test("accepts quarter sequence with fractions, simultaneous events/rest, tie and JSON round trip", () => {
  const sequence = quarterSequence();
  assert.equal(validateNoteSequence(sequence).valid, true);
  assert.equal(validateNoteSequence(JSON.parse(JSON.stringify(sequence))).valid, true);
});

test("accepts seconds audio sequence", () => {
  const sequence = { ...quarterSequence(), id: "audio", title: "转录", timeBase: "second" as const,
    events: [{ id: "a", trackId: "main", voiceId: "v", order: 0, time: { unit: "second" as const, start: 0.25, duration: null }, kind: "note" as const, pitch: { midi: 72, cents: -3.5 }, confidence: 0.8 }],
    tempoMap: [], meterMap: [], annotations: [], sources: [{ id: "audio", format: "audio" as const }] };
  assert.equal(validateNoteSequence(sequence).valid, true);
});

test("rejects representative malformed values without throwing", () => {
  const base = quarterSequence();
  const cases: unknown[] = [
    null, { ...base, tracks: null }, { ...base, sources: [null] },
    { ...base, events: [{ ...base.events[0], trackId: 1 }] },
    { ...base, events: [{ ...base.events[0], voiceId: 2 }] },
    { ...base, events: [{ ...base.events[0], kind: "rest", pitch: { midi: 60, cents: 0 } }] },
    { ...base, events: [{ ...base.events[0], sourceRef: { sourceId: "native", token: 4 } }] },
    { ...base, events: [{ ...base.events[0], pitch: { midi: 60, cents: Number.NaN } }] },
    { ...base, meterMap: [{ at: { numerator: 0, denominator: 1 }, beats: 4, beatType: 4 }, { at: { numerator: 0, denominator: 1 }, beats: 3, beatType: 4 }] },
    { ...base, lyrics: [{ id: "l", text: "x", eventIds: ["r1"], alignment: "manual" }] },
    { ...base, events: [{ ...base.events[0], sourceRef: { sourceId: "native", line: 1 } }] },
    { ...base, sources: [{ id: "native", format: "native", instrument: null }] },
  ];
  for (const value of cases) { assert.doesNotThrow(() => validateNoteSequence(value)); assert.equal(validateNoteSequence(value).valid, false); }
});
