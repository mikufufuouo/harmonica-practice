import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import {
  deleteImageSong,
  exportImageFiles,
  getScoreImage,
  importImageFiles,
  listImageSongs,
  updateImageSong,
  validateImageManifest,
  type ImageManifest,
} from "../src/image-score-library.ts";

const stamp = "2026-09-26T00:00:00.000Z";
function makeManifest(
  overrides: Partial<ImageManifest["songs"][number]> = {},
): ImageManifest {
  return {
    format: "harmonica-image-scores",
    version: 1,
    songs: [
      {
        id: "panda-song",
        title: "月光",
        author: "作者",
        createdAt: stamp,
        updatedAt: stamp,
        pages: [
          { assetId: "untrusted-id", path: "月光/01.png" },
          { assetId: "another", path: "月光/02.jpg" },
        ],
        ...overrides,
      },
    ],
  };
}
function file(
  name: string,
  content: string | Blob,
  type = "application/json",
  rel = name,
): File {
  const value = new File([content], name, { type }) as File & {
    webkitRelativePath: string;
  };
  Object.defineProperty(value, "webkitRelativePath", { value: rel });
  return value;
}
function files(manifest: ImageManifest, root = "upload"): File[] {
  const imageFiles = manifest.songs.flatMap((song) =>
    song.pages.map((page) => {
      const extension = page.path.split(".").at(-1)?.toLowerCase();
      const type =
        extension === "png"
          ? "image/png"
          : extension === "jpg" || extension === "jpeg"
            ? "image/jpeg"
            : extension === "webp"
              ? "image/webp"
              : "image/gif";
      return file(
        page.path.split("/").at(-1)!,
        new Blob([page.path], { type }),
        type,
        `${root}/${page.path}`,
      );
    }),
  );
  return [
    file(
      "manifest.json",
      JSON.stringify(manifest),
      "application/json",
      `${root}/manifest.json`,
    ),
    ...imageFiles,
  ];
}
function backupFiles(
  backup: Awaited<ReturnType<typeof exportImageFiles>>,
): File[] {
  return [
    file("manifest.json", JSON.stringify(backup.manifest)),
    ...backup.assets.map(({ path, blob }) =>
      file(path.split("/").at(-1)!, blob, blob.type, path),
    ),
  ];
}

test("validates metadata, rejects unsafe paths and rebuilds deterministic asset references", () => {
  const normalized = validateImageManifest(makeManifest());
  assert.notEqual(normalized.songs[0]!.pages[0]!.assetId, "untrusted-id");
  assert.equal(
    normalized.songs[0]!.pages[0]!.assetId,
    validateImageManifest(makeManifest()).songs[0]!.pages[0]!.assetId,
  );
  for (const path of [
    "../outside.png",
    "/absolute.png",
    "https://host/image.png",
    "a\\b.png",
    "a//b.png",
  ])
    assert.throws(() =>
      validateImageManifest(makeManifest({ pages: [{ path, assetId: "x" }] })),
    );
  assert.throws(
    () =>
      validateImageManifest(
        makeManifest({
          source: { name: "source", url: "javascript:alert(1)" },
        }),
      ),
    /HTTP or HTTPS/,
  );
});

test("imports a directory atomically, preserves user state on reimport, exports images and removes orphaned assets", async () => {
  const input = files(makeManifest());
  assert.deepEqual(await importImageFiles(input), { imported: 1 });
  let song = (await listImageSongs())[0]!;
  const originalAsset = song.pages[0]!.assetId;
  assert.ok(await getScoreImage(originalAsset));
  await updateImageSong(song.id, {
    favorite: true,
    lastOpenedAt: stamp,
    bdEntryId: "bd-1",
  });

  const changed = makeManifest({
    title: "月光（更新）",
    pages: [{ path: "更新/唯一.webp", assetId: "spoof" }],
  });
  await importImageFiles(files(changed, "renamed-root"));
  song = (await listImageSongs())[0]!;
  assert.equal(song.title, "月光（更新）");
  assert.equal(song.favorite, true);
  assert.equal(song.lastOpenedAt, stamp);
  assert.equal(song.bdEntryId, "bd-1");
  assert.notEqual(song.pages[0]!.assetId, originalAsset);
  assert.equal(await getScoreImage(originalAsset), null);
  const backup = await exportImageFiles();
  assert.equal(backup.manifest.songs.length, 1);
  assert.deepEqual(
    backup.assets.map((asset) => asset.path),
    ["scores/panda-song/001.webp"],
  );
  const once = backup.assets[0]!.path;
  await importImageFiles(backupFiles(backup));
  const secondBackup = await exportImageFiles();
  assert.equal(secondBackup.assets[0]!.path, once);

  await deleteImageSong(song.id);
  assert.deepEqual(await listImageSongs(), []);
  assert.equal(await getScoreImage(song.pages[0]!.assetId), null);
});

test("rejects missing assets and unsupported MIME before writing any songs", async () => {
  await assert.rejects(
    importImageFiles([
      file("manifest.json", JSON.stringify(makeManifest()), "application/json"),
    ]),
  );
  assert.deepEqual(await listImageSongs(), []);
  const bad = files(makeManifest());
  bad[1] = file(
    "01.png",
    new Blob(["bad"]),
    "application/octet-stream",
    "upload/月光/01.png",
  );
  await assert.rejects(importImageFiles(bad), /Unsupported image MIME/);
  assert.deepEqual(await listImageSongs(), []);
});

test("rolls back every record when an IndexedDB asset write fails mid-import", async () => {
  const prototype = IDBObjectStore.prototype;
  const originalPut = prototype.put;
  prototype.put = function (
    this: IDBObjectStore,
    ...args: Parameters<IDBObjectStore["put"]>
  ) {
    if (this.name === "assets")
      throw new DOMException("simulated clone failure", "DataCloneError");
    return originalPut.apply(this, args);
  };
  try {
    await assert.rejects(importImageFiles(files(makeManifest())));
  } finally {
    prototype.put = originalPut;
  }
  assert.deepEqual(await listImageSongs(), []);
  assert.equal(
    await getScoreImage(
      validateImageManifest(makeManifest()).songs[0]!.pages[0]!.assetId,
    ),
    null,
  );
});

test("listing returns metadata only, without image blobs", async () => {
  await importImageFiles(files(makeManifest()));
  const listed = (await listImageSongs())[0]!;
  assert.equal(Object.hasOwn(listed, "blob"), false);
  assert.deepEqual(Object.keys(listed.pages[0]!).sort(), ["assetId", "path"]);
});
