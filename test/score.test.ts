import assert from "node:assert/strict";
import test from "node:test";
import {
  generateFingeringPlan,
  importBdText,
  validateNoteSequence,
} from "../src/score/index.ts";

test("imports C BD as unmetered pitches and keeps a lyric line unassigned", () => {
  const result = importBdText("4B 4D 5B\n你好， 世界", { sourceKey: "C" });
  assert.ok(result.sequence);
  assert.deepEqual(
    result.sequence.events.map((event) =>
      event.kind === "note" ? event.pitch.midi : null,
    ),
    [72, 74, 76],
  );
  assert.ok(result.sequence.events.every((event) => event.time === null));
  assert.ok(
    result.sequence.lyrics.every(
      (lyric) =>
        lyric.alignment === "unassigned" && lyric.eventIds.length === 0,
    ),
  );
  assert.deepEqual(
    result.sequence.lyrics.map((lyric) => lyric.text),
    ["你好， 世界"],
  );
});

test("rejects malformed BD instead of silently extracting notes", () => {
  for (const text of [
    "11B",
    "4X",
    "4D'",
    "[4B 5B]",
    "4B-",
    "04B",
    "4B 歌词4D",
    "4B【5B】",
    "4B B4D",
    "4B.",
  ])
    assert.equal(importBdText(text, { sourceKey: "C" }).sequence, null, text);
  const separated = importBdText("4B | 4D", { sourceKey: "C" });
  assert.ok(separated.sequence);
  assert.deepEqual(separated.sequence.lyrics, []);
});

test("maps actual pitches without BD source metadata and validates malformed values without throw", () => {
  const sequence = {
    schemaVersion: 1 as const,
    id: "manual",
    title: "manual",
    timeBase: "unmetered" as const,
    tracks: [{ id: "t", name: "t" }],
    events: [
      {
        id: "n",
        trackId: "t",
        voiceId: "v",
        order: 0,
        time: null,
        kind: "note" as const,
        pitch: { midi: 67, cents: 0 },
      },
    ],
    tempoMap: [],
    meterMap: [],
    annotations: [],
    lyrics: [],
    sources: [],
  };
  assert.equal(validateNoteSequence(sequence).valid, true);
  assert.equal(
    generateFingeringPlan(sequence, "C").items[0].status,
    "ambiguous",
  );
  assert.doesNotThrow(() =>
    validateNoteSequence({ tracks: {}, events: [null], lyrics: [{ id: "x" }] }),
  );
});

test("keeps source pitches unchanged while explicit transposition targets D harp", () => {
  const imported = importBdText("４Ｂ４Ｄ５Ｂ", { sourceKey: "C" });
  assert.ok(imported.sequence);
  const original = imported.sequence.events.map((event) =>
    event.kind === "note" ? event.pitch.midi : -1,
  );
  assert.equal(generateFingeringPlan(imported.sequence, "D").transposeSemitones, 0);
  assert.equal(generateFingeringPlan(imported.sequence, "D").items[0].status, "unplayable");
  assert.deepEqual(
    generateFingeringPlan(imported.sequence, "D", {
      transposeSemitones: 2,
    }).items.map((item) => item.preferred?.label),
    ["4B", "4D", "5B"],
  );
  assert.deepEqual(
    imported.sequence.events.map((event) =>
      event.kind === "note" ? event.pitch.midi : -1,
    ),
    original,
  );
  const micro = {
    ...imported.sequence,
    events: [
      { ...imported.sequence.events[0], pitch: { midi: 72, cents: 20 } },
    ],
  };
  assert.equal(generateFingeringPlan(micro, "C").items[0].status, "unplayable");
});
