import assert from "node:assert/strict";
import test from "node:test";
import {
  parseJianpu,
  soloCandidates,
  optimizeSoloPath,
  melodyEligibility,
} from "../src/score/jianpu.ts";
import {
  saveChromaticSequence,
  listEntries,
  validateLibraryBackup,
} from "../src/score-library.ts";
import { indexedDB } from "fake-indexeddb";

test("strict jianpu parser handles key, accidental, local octave and barline", () => {
  const result = parseJianpu("1=C\n1 #4 5' | 2.", { title: "x" });
  assert.ok(result.sequence);
  assert.deepEqual(
    result.sequence.events.map((e) => (e.kind === "note" ? e.pitch.midi : -1)),
    [60, 66, 79, 50],
  );
  assert.equal(
    result.sequence.events.every((e) => e.time === null),
    true,
  );
  assert.equal(result.sequence.annotations[0]?.kind, "barline");
  assert.equal(parseJianpu("1=C\n1x2", { title: "x" }).sequence, null);
  assert.equal(parseJianpu("1=C\n0 1", { title: "x" }).sequence, null);
  assert.equal(parseJianpu("1=C\n1 #", { title: "x" }).sequence, null);
  assert.equal(parseJianpu("1=C\n#| 1", { title: "x" }).sequence, null);
  assert.equal(
    parseJianpu("1=C\n1", { title: "x" }).sequence?.sources[0]?.format,
    "jianpu",
  );
  assert.equal(
    parseJianpu("1=C#\n1", { title: "x" }).sequence?.events[0]?.kind ===
      "note" &&
      parseJianpu("1=C#\n1", { title: "x" }).sequence!.events[0]!.kind ===
        "note"
      ? (
          parseJianpu("1=C#\n1", { title: "x" }).sequence!.events[0] as Extract<
            (typeof result.sequence.events)[number],
            { kind: "note" }
          >
        ).pitch.midi
      : 0,
    61,
  );
});

test("Solo retains enharmonic duplicates and global optimization picks a continuous path", () => {
  const c = soloCandidates(72, "C").map((x) => x.label);
  assert.ok(c.includes("4B"));
  assert.ok(c.includes("5B"));
  const path = optimizeSoloPath(
    [{ midi: 60 }, { midi: 62 }, { midi: 64 }],
    "C",
  );
  assert.deepEqual(
    path.map((x) => x?.label),
    ["1B", "1D", "2B"],
  );
  assert.equal(soloCandidates(60, "C")[0]?.label, "1B");
  assert.ok(soloCandidates(96, "C").some((x) => x.label === "12D推键"));
  assert.ok(soloCandidates(97, "C").some((x) => x.label === "12B推键"));
  assert.equal(
    Array.from({ length: 38 }, (_, i) => soloCandidates(i + 60, "C").length).reduce(
      (total, count) => total + count,
      0,
    ),
    48,
  );
  const pinned = optimizeSoloPath(
    [{ midi: 76 }, { midi: 72 }, { midi: 74 }],
    "C",
    { 1: "4B" },
  );
  assert.equal(pinned[1]?.label, "4B");
  assert.equal(pinned[2]?.label, "5D");
});

test("chromatic save validates sequence and persists manual fingering overrides", async () => {
  Object.defineProperty(globalThis, "indexedDB", {
    value: indexedDB,
    configurable: true,
  });
  const sequence = parseJianpu("1=C\n1 2", {
    title: "存储边界",
  }).sequence!;
  const before = (await listEntries()).length;
  const entry = await saveChromaticSequence(
    sequence,
    { model: "kb12-solo-assumed", key: "C" },
    { "event-1": { midi: 60, label: "1B" } },
  );
  assert.equal((await listEntries()).length, before + 1);
  assert.equal(entry.fingeringOverrides?.["event-1"]?.label, "1B");
  assert.equal(entry.chromaticProfile?.octaveShift, 0);
  await assert.rejects(() =>
    saveChromaticSequence(
      { ...sequence, events: [] },
      { model: "kb12-solo-assumed", key: "C" },
    ),
  );
  await assert.rejects(() =>
    saveChromaticSequence(
      sequence,
      { model: "kb12-solo-assumed", key: "C" },
      { "event-1": { midi: 60, label: "12B" } },
    ),
  );
  const outOfRange = structuredClone(sequence);
  if (outOfRange.events[0]?.kind === "note") outOfRange.events[0].pitch.midi = 59;
  await assert.rejects(() =>
    saveChromaticSequence(outOfRange, { model: "kb12-solo-assumed", key: "C" }),
  );
  const simultaneous = structuredClone(sequence);
  simultaneous.events[1]!.order = simultaneous.events[0]!.order;
  assert.ok(melodyEligibility(simultaneous).length);
  assert.equal(
    validateLibraryBackup({
      schemaVersion: 1,
      entries: [{ ...entry, chromaticProfile: undefined }],
    }).entries.length,
    0,
  );
});

test("chromatic octave shift preserves source pitches and validates target fingering", async () => {
  Object.defineProperty(globalThis, "indexedDB", {
    value: indexedDB,
    configurable: true,
  });
  const source = structuredClone(parseJianpu("1=C\n1 2", { title: "八度" }).sequence!);
  const first = source.events[0]!;
  assert.equal(first.kind, "note");
  if (first.kind !== "note") return;
  first.pitch.midi = 58;
  const target = 70;
  const fingering = soloCandidates(target, "C")[0]!;
  const entry = await saveChromaticSequence(
    source,
    { model: "kb12-solo-assumed", key: "C", octaveShift: 12 },
    { [first.id]: { midi: target, label: fingering.label } },
  );
  assert.equal(entry.sequence.events[0]?.kind, "note");
  if (entry.sequence.events[0]?.kind === "note")
    assert.equal(entry.sequence.events[0].pitch.midi, 58);
  assert.equal(entry.chromaticProfile?.octaveShift, 12);
  assert.equal(entry.fingeringOverrides?.[first.id]?.midi, 70);
  assert.equal((await listEntries()).find((item) => item.id === entry.id)?.chromaticProfile?.octaveShift, 12);
  await assert.rejects(() =>
    saveChromaticSequence(source, { model: "kb12-solo-assumed", key: "C", octaveShift: 24 as 12 }),
  );
  await assert.rejects(() =>
    saveChromaticSequence(
      source,
      { model: "kb12-solo-assumed", key: "C", octaveShift: 12 },
      { [first.id]: { midi: 58, label: "1B" } },
    ),
  );
  const invalid = validateLibraryBackup({
    schemaVersion: 1,
    entries: [{ ...entry, chromaticProfile: { ...entry.chromaticProfile, octaveShift: 13 as 12 } }],
  });
  assert.equal(invalid.entries.length, 0);
});
