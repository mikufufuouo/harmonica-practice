import { test } from "node:test";
import assert from "node:assert/strict";
import type { NoteSequence, SequenceEvent } from "../src/score/types.ts";
import {
  buildPracticeProjection,
  layoutPracticeRows,
} from "../src/practice-score.ts";
import { soloCandidates } from "../src/score/jianpu.ts";

function fraction(value: number) {
  return Number.isInteger(value)
    ? { numerator: value, denominator: 1 }
    : { numerator: Math.round(value * 2), denominator: 2 };
}
function note(
  id: string,
  order: number,
  start: number,
  duration: number | null,
  extra: Partial<SequenceEvent> = {},
): SequenceEvent {
  return {
    id,
    trackId: "t",
    voiceId: "v",
    order,
    time:
      duration === null
        ? null
        : {
            unit: "quarter",
            start: fraction(start),
            duration: fraction(duration),
          },
    kind: "note",
    pitch: { midi: 60, cents: 0 },
    ...extra,
  } as SequenceEvent;
}
function rest(
  id: string,
  order: number,
  start: number,
  duration: number,
): SequenceEvent {
  return {
    id,
    trackId: "t",
    voiceId: "v",
    order,
    time: {
      unit: "quarter",
      start: fraction(start),
      duration: fraction(duration),
    },
    kind: "rest",
  };
}
function sequence(
  events: SequenceEvent[],
  annotations: NoteSequence["annotations"] = [],
  meterMap: NoteSequence["meterMap"] = [],
  timeBase: NoteSequence["timeBase"] = "quarter",
): NoteSequence {
  return {
    schemaVersion: 1,
    id: "s",
    title: "sample",
    timeBase,
    tracks: [{ id: "t", name: "melody" }],
    events,
    tempoMap: [],
    meterMap,
    annotations,
    lyrics: [],
    sources: [],
  };
}

test("projection keeps explicit rests, durations, barlines and unknown rhythm distinct", () => {
  const score = sequence(
    [note("a", 0, 0, 0.5), rest("r", 1, 0.5, 1), note("b", 2, 1.5, 2)],
    [{ kind: "barline", beforeEventId: "b" }],
  );
  const projection = buildPracticeProjection(score);
  assert.equal(projection.items[0]!.durationText, "½♩");
  assert.equal(projection.items[1]!.kind, "rest");
  assert.equal(projection.items[1]!.durationText, "1♩");
  assert.equal(projection.items[2]!.barlineBefore, true);
  assert.equal(projection.items[2]!.durationText, "2♩");

  const unknown = buildPracticeProjection(
    sequence([note("u", 0, 0, null)], [], [], "unmetered"),
  );
  assert.equal(unknown.items[0]!.timingUnknown, true);
  assert.match(unknown.timingDescription, /节奏未知/);

  const secondsScore = sequence(
    [
      {
        id: "seconds",
        trackId: "t",
        voiceId: "v",
        order: 0,
        time: { unit: "second", start: 0, duration: 0.4 },
        kind: "note",
        pitch: { midi: 60, cents: 0 },
      },
    ],
    [],
    [{ at: { numerator: 0, denominator: 1 }, beats: 4, beatType: 4 }],
    "second",
  );
  const secondsProjection = buildPracticeProjection(secondsScore);
  assert.match(secondsProjection.timingDescription, /按秒时长/);
  assert.equal(secondsProjection.meterDescription, "");
});

test("ties share one chosen fingering, keep continuation event and report conflicting overrides", () => {
  const candidates = soloCandidates(72);
  const first = candidates[0]!.label;
  const other = candidates.find(
    (candidate) => candidate.label !== first,
  )!.label;
  const score = sequence(
    [
      note("tie-a", 0, 0, 1, {
        tieGroupId: "tie",
        pitch: { midi: 72, cents: 0 },
      }),
      note("tie-b", 1, 1, 1, {
        tieGroupId: "tie",
        pitch: { midi: 72, cents: 0 },
      }),
    ],
    [{ kind: "barline", beforeEventId: "tie-b" }],
  );
  const projection = buildPracticeProjection(score, {
    overrides: {
      "tie-a": { midi: 72, label: first },
      "tie-b": { midi: 72, label: other },
    },
  });
  assert.equal(projection.items[0]!.label, projection.items[1]!.label);
  assert.equal(projection.items[0]!.attack, true);
  assert.equal(projection.items[1]!.attack, false);
  assert.equal(projection.items[1]!.tieContinuation, true);
  assert.deepEqual(projection.tieOverrideConflicts, ["tie"]);
  assert.equal(projection.items[1]!.barlineBefore, true);
});

test("layout preserves duration weight and rest spacing, packs full bars when possible", () => {
  const score = sequence(
    [
      note("short", 0, 0, 0.5),
      rest("pause", 1, 0.5, 1),
      note("long", 2, 1.5, 2),
      note("bar-two", 3, 4, 1),
    ],
    [{ kind: "barline", beforeEventId: "bar-two" }],
  );
  const projection = buildPracticeProjection(score);
  const rows = layoutPracticeRows(projection.items, 150, score);
  const slots = rows.flatMap((row) => row.items);
  assert.equal(slots.length, score.events.length);
  const short = slots.find((slot) => slot.item.eventId === "short")!;
  const long = slots.find((slot) => slot.item.eventId === "long")!;
  const restSlot = slots.find((slot) => slot.item.kind === "rest")!;
  assert.ok(long.durationWidth > short.durationWidth);
  assert.ok(restSlot.width > 0);
  assert.ok(
    rows.some((row) =>
      row.items.some((slot) => slot.item.eventId === "bar-two"),
    ),
  );
  assert.deepEqual(
    rows[0]!.items.map((slot) => slot.item.eventId),
    ["short", "pause"],
    "a complete measure stays together when it fits",
  );
  for (const row of rows) {
    const used =
      row.items.reduce((sum, slot) => sum + slot.width, 0) +
      Math.max(0, row.items.length - 1) * 8;
    assert.ok(used <= 150, `row width ${used} exceeds available width`);
  }
});

test("oversized measure wraps only at event boundaries without losing or duplicating items", () => {
  const score = sequence([
    note("a", 0, 0, 2),
    rest("r", 1, 2, 2),
    note("c", 2, 4, 2),
  ]);
  const projection = buildPracticeProjection(score);
  const rows = layoutPracticeRows(projection.items, 70, score);
  const flattened = rows.flatMap((row) =>
    row.items.map((slot) => slot.item.eventId),
  );
  assert.deepEqual(flattened, ["a", "r", "c"]);
  assert.ok(rows.length > 1);
  for (const row of rows) {
    const used =
      row.items.reduce((sum, slot) => sum + slot.width, 0) +
      Math.max(0, row.items.length - 1) * 8;
    assert.ok(used <= 70);
  }
});

test("rebalances seven short notes to avoid a one-note row and preserves the next bar", () => {
  const firstBar = Array.from({ length: 7 }, (_, index) =>
    note(`e${index + 1}`, index, index / 2, 0.5),
  );
  const score = sequence(
    [...firstBar, note("next-bar", 7, 3.5, 0.5)],
    [{ kind: "barline", beforeEventId: "next-bar" }],
  );
  const projection = buildPracticeProjection(score);
  const rows = layoutPracticeRows(projection.items, 324, score);
  assert.deepEqual(
    rows.map((row) => row.items.map((slot) => slot.item.eventId)),
    [
      ["e1", "e2", "e3", "e4"],
      ["e5", "e6", "e7", "next-bar"],
    ],
  );
  assert.equal(rows[1]!.items.at(-1)!.item.barlineBefore, true);
  assert.deepEqual(
    rows.flatMap((row) => row.items.map((slot) => slot.item.eventId)),
    score.events.map((event) => event.id),
    "rebalancing preserves order and every event exactly once",
  );
  for (const row of rows) {
    const used =
      row.items.reduce((sum, slot) => sum + slot.width, 0) +
      Math.max(0, row.items.length - 1) * 8;
    assert.ok(used <= 324, `row width ${used} exceeds available width`);
  }
});

test("quarter meter can infer bar boundary and hard phrase break starts a new row", () => {
  const meter = [
    { at: { numerator: 0, denominator: 1 }, beats: 4, beatType: 4 },
  ];
  const score = sequence(
    [note("one", 0, 0, 4), note("two", 1, 4, 1)],
    [{ kind: "line-break", beforeEventId: "two" }],
    meter,
  );
  const projection = buildPracticeProjection(score);
  assert.match(projection.timingDescription, /推测/);
  const rows = layoutPracticeRows(projection.items, 120, score);
  assert.equal(rows.length, 2);
  assert.equal(rows[1]!.items[0]!.item.eventId, "two");
  assert.equal(rows[1]!.items[0]!.item.barlineBefore, true);
});
