import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import {
  makeSequence,
  validateLibraryBackup,
  type LibraryEntry,
  type ScoreDraft,
} from "../src/score-library.ts";
import {
  deleteDraft,
  deleteEntry,
  getImage,
  importEntries,
  listDrafts,
  listEntries,
  saveDraft,
  saveConfirmedDraft,
} from "../src/score-library.ts";

function draft(overrides: Partial<ScoreDraft> = {}): ScoreDraft {
  return {
    version: 1,
    id: "draft",
    title: "test",
    sourceKey: "C",
    assetId: "asset",
    imageName: "test.png",
    createdAt: "2026-09-14T00:00:00Z",
    updatedAt: "2026-09-14T00:00:00Z",
    ocrOriginal: "4B 4D",
    fullImageConfirmed: true,
    lines: [
      {
        id: "line",
        kind: "bd",
        original: "4B 4D",
        edited: "4B 4D",
        confirmed: true,
      },
    ],
    ...overrides,
  };
}

test("requires a key, every row, full-image review, and classified OCR text", () => {
  assert.equal(makeSequence(draft({ sourceKey: "" })).sequence, null);
  assert.equal(
    makeSequence(draft({ fullImageConfirmed: false })).sequence,
    null,
  );
  const malformed = makeSequence(
    draft({
      lines: [
        {
          id: "line",
          kind: "bd",
          original: "4B 4X",
          edited: "4B 4X",
          confirmed: true,
        },
      ],
    }),
  );
  assert.equal(malformed.sequence, null);
  assert.match(malformed.errors[0], /BD第1行第/);
  assert.match(malformed.errors[0], /4X/);
  assert.doesNotMatch(malformed.errors[0], /拆分为歌词/);
  assert.equal(
    makeSequence(
      draft({
        lines: [
          {
            id: "line",
            kind: "bd",
            original: "4B",
            edited: "4B",
            confirmed: false,
          },
        ],
      }),
    ).sequence,
    null,
  );
});

test("permits corrected and then re-confirmed lines", () => {
  const value = makeSequence(
    draft({
      lines: [
        {
          id: "line",
          kind: "bd",
          original: "4B 4X",
          edited: "4B 4D",
          confirmed: true,
        },
      ],
    }),
  );
  assert.equal(value.sequence?.events.length, 2);
});

test("accepts a legacy single-song JSON and rejects null backup entries", () => {
  const sequence = makeSequence(draft()).sequence!;
  const entry: LibraryEntry = {
    version: 1,
    id: "backup-entry",
    title: "backup",
    createdAt: "2026-09-14T00:00:00Z",
    updatedAt: "2026-09-14T00:00:00Z",
    assetId: "asset",
    sequence,
  };
  assert.equal(validateLibraryBackup(sequence).entries.length, 1);
  assert.equal(
    validateLibraryBackup({ schemaVersion: 1, entries: [null] }).errors.length,
    1,
  );
  assert.equal(
    validateLibraryBackup({
      schemaVersion: 1,
      entries: [{ ...entry, createdAt: "not a date" }],
    }).errors.length,
    1,
  );
  const missingUpdatedAt = { ...entry } as Partial<LibraryEntry>;
  delete missingUpdatedAt.updatedAt;
  assert.equal(
    validateLibraryBackup({
      schemaVersion: 1,
      entries: [missingUpdatedAt],
    }).errors.length,
    1,
  );
});

test("persists and cleans an unreferenced draft image", async () => {
  const value = draft({ id: "persistent-draft", assetId: "persistent-asset" });
  await saveDraft(value, new Blob(["image"]));
  assert.equal(
    (await listDrafts()).some((item) => item.id === value.id),
    true,
  );
  assert.ok(await getImage(value.assetId));
  await deleteDraft(value.id);
  assert.equal(await getImage(value.assetId), null);
});

test("aborts image and draft together when the draft cannot be cloned", async () => {
  const value = draft({ id: "aborted-draft", assetId: "aborted-asset" });
  const invalid = { ...value, invalid: () => undefined } as ScoreDraft;
  await assert.rejects(saveDraft(invalid, new Blob(["image"])));
  assert.equal(await getImage(value.assetId), null);
  assert.equal(
    (await listDrafts()).some((item) => item.id === value.id),
    false,
  );
});

test("keeps a shared image until its last draft and entry reference is deleted", async () => {
  const first = draft({ id: "shared-draft-1", assetId: "shared-asset" });
  const second = draft({ id: "shared-draft-2", assetId: "shared-asset" });
  await saveDraft(first, new Blob(["image"]));
  await saveDraft(second);
  const firstEntry = await saveConfirmedDraft(first);
  const secondEntry = await saveConfirmedDraft(second);

  await deleteDraft(first.id);
  assert.ok(await getImage(first.assetId));
  await deleteEntry(firstEntry.id);
  assert.ok(await getImage(first.assetId));
  await deleteEntry(secondEntry.id);
  assert.ok(await getImage(first.assetId));
  await deleteDraft(second.id);
  assert.equal(await getImage(first.assetId), null);
});

test("imports a batch atomically and does not overwrite repeated imports", async () => {
  const sequence = makeSequence(draft()).sequence!;
  const base = {
    version: 1 as const,
    id: "backup-entry",
    title: "backup",
    createdAt: "2026-09-14T00:00:00Z",
    updatedAt: "2026-09-14T00:00:00Z",
    assetId: "old-asset",
    sequence,
  };
  const before = (await listEntries()).length;
  await assert.rejects(
    importEntries([
      base,
      { ...base, id: "bad-entry", invalid: () => undefined } as typeof base,
    ]),
  );
  assert.equal((await listEntries()).length, before);

  await importEntries([base]);
  await importEntries([base]);
  const imported = (await listEntries()).filter(
    (item) => item.title === base.title,
  );
  assert.equal(imported.length, 2);
  assert.notEqual(imported[0].id, imported[1].id);
  assert.equal(imported[0].assetId, "");
  assert.equal(imported[0].draftId, undefined);
});
