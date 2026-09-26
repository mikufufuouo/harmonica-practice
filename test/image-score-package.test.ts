import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { zipSync, strToU8, unzipSync } from "fflate";
import { importScoreZip, exportScoreZip } from "../src/image-score-package.ts";
import { listImageSongs, getScoreImage } from "../src/image-score-library.ts";

test("ZIP transfer keeps original bytes and page order across backup restore", async () => {
  globalThis.indexedDB = new IDBFactory();
  const manifest = {
    format: "harmonica-image-scores",
    version: 1,
    songs: [
      {
        id: "own-test",
        title: "自造多页样例",
        createdAt: "2026-09-26",
        updatedAt: "2026-09-26",
        pages: [{ path: "pages/02.png" }, { path: "pages/01.png" }],
      },
    ],
  };
  const bytes = zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest)),
    "pages/01.png": new Uint8Array([1, 2]),
    "pages/02.png": new Uint8Array([3, 4]),
  });
  assert.equal(
    (await importScoreZip(new File([bytes], "scores.zip"))).imported,
    1,
  );
  const [song] = await listImageSongs();
  assert.deepEqual(
    new Uint8Array(
      await (await getScoreImage(song.pages[0].assetId))!.arrayBuffer(),
    ),
    new Uint8Array([3, 4]),
  );
  const backup = await exportScoreZip();
  assert.equal(
    Object.keys(unzipSync(new Uint8Array(await backup.arrayBuffer()))).length,
    3,
  );
  globalThis.indexedDB = new IDBFactory();
  await importScoreZip(new File([backup], "restore.zip"));
  const [restored] = await listImageSongs();
  assert.equal(restored.title, song.title);
  assert.deepEqual(
    new Uint8Array(
      await (await getScoreImage(restored.pages[0].assetId))!.arrayBuffer(),
    ),
    new Uint8Array([3, 4]),
  );
});

test("bad ZIP and missing page fail without partial import", async () => {
  globalThis.indexedDB = new IDBFactory();
  await assert.rejects(importScoreZip(new File(["bad"], "bad.zip")));
  const manifest = {
    format: "harmonica-image-scores",
    version: 1,
    songs: [
      {
        id: "missing",
        title: "缺图",
        createdAt: "2026-09-26",
        updatedAt: "2026-09-26",
        pages: [{ path: "missing.png" }],
      },
    ],
  };
  const bytes = zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)) });
  await assert.rejects(
    importScoreZip(new File([bytes], "missing.zip")),
    /Missing image/,
  );
  assert.deepEqual(await listImageSongs(), []);
});
