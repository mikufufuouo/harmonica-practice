import test from "node:test";
import assert from "node:assert/strict";
import { parseJianpuSpace } from "../scripts/jianpu-space-to-sequence.ts";

const midi = (
  sequence: NonNullable<ReturnType<typeof parseJianpuSpace>["sequence"]>,
) =>
  sequence.events.map((event) =>
    event.kind === "note" ? event.pitch.midi : "rest",
  );
const quarters = (
  event: NonNullable<
    ReturnType<typeof parseJianpuSpace>["sequence"]
  >["events"][number],
) => {
  assert.notEqual(event.time, null);
  assert.equal(event.time!.unit, "quarter");
  const duration = event.time!.duration!;
  return duration.numerator / duration.denominator;
};

test("jianpu.space key octave, note octave, rests, subdivision and source refs", () => {
  const result = parseJianpuSpace("/key(Bb3)\nｂｐｍ85\n1'_2,0_3=", {
    title: "自造测试",
    sourceUrl: "https://example.test/score",
  });
  assert.deepEqual(result.errors, []);
  assert.ok(result.sequence);
  assert.deepEqual(midi(result.sequence), [70, 48, "rest", 62]);
  assert.deepEqual(result.sequence.events.map(quarters), [0.5, 1, 0.5, 0.25]);
  assert.equal(result.sequence.tempoMap[0]?.bpm, 85);
  assert.deepEqual(result.sequence.events[0]?.sourceRef, {
    sourceId: "jianpu-space-source",
    line: 3,
    column: 1,
    token: "1'_",
  });
  assert.equal(result.sequence.events[2]?.kind, "rest");
});

test("jianpu.space tied dash extends the preceding event and preserves its elapsed time", () => {
  const result = parseJianpuSpace("/key(C4)\n1_ - 2");
  assert.deepEqual(result.errors, []);
  assert.ok(result.sequence);
  assert.deepEqual(midi(result.sequence), [60, 62]);
  assert.deepEqual(result.sequence.events.map(quarters), [1.5, 1]);
  assert.equal(result.sequence.events[1]?.time?.unit, "quarter");
  if (result.sequence.events[1]?.time?.unit === "quarter")
    assert.deepEqual(result.sequence.events[1].time.start, {
      numerator: 3,
      denominator: 2,
    });
});

test("a tie continuation across a barline splits into same-pitch tied events", () => {
  const result = parseJianpuSpace("/key(C4)\n1_|-2");
  assert.deepEqual(result.errors, []);
  assert.ok(result.sequence);
  assert.deepEqual(midi(result.sequence), [60, 60, 62]);
  const [head, continuation] = result.sequence.events;
  assert.equal(head?.tieGroupId, continuation?.tieGroupId);
  assert.deepEqual(continuation?.sourceRef, {
    sourceId: "jianpu-space-source",
    line: 2,
    column: 4,
    token: "-",
  });
  assert.deepEqual(
    result.sequence.annotations.find((a) => a.kind === "barline"),
    {
      kind: "barline",
      beforeEventId: continuation?.id,
    },
  );
});

test("jianpu.space accidental and dotted durations follow the site parser", () => {
  const result = parseJianpuSpace("/key(F4)\nb7. ##4= 1-");
  assert.deepEqual(result.errors, []);
  assert.ok(result.sequence);
  assert.deepEqual(midi(result.sequence), [75, 72, 65]);
  assert.deepEqual(result.sequence.events.map(quarters), [1.5, 0.25, 2]);
});

test("unknown or orphaned notation aborts instead of returning partial notes", () => {
  for (const notation of [
    "/key(C4)\n1__2",
    "/key(C4)\n1?2",
    "/key(C4)\n'1",
    "/key(C4)\n1....",
  ]) {
    const result = parseJianpuSpace(notation);
    assert.equal(result.sequence, null, notation);
    assert.ok(result.errors.length, notation);
  }
});
