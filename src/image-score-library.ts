export type ImageScorePage = { assetId: string; path: string };
export type ImageSong = {
  id: string;
  title: string;
  author?: string;
  source?: { name: string; url?: string };
  difficulty?: string;
  key?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  favorite?: boolean;
  lastOpenedAt?: string;
  bdEntryId?: string;
  pages: ImageScorePage[];
};
export type ImageManifest = {
  format: "harmonica-image-scores";
  version: 1;
  songs: ImageSong[];
};

const DB = "harmonica-image-scores";
const VERSION = 1;
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

function fail(message: string): never {
  throw new Error(message);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim())
    fail(`${label} must be a non-empty string`);
  return value.trim();
}
function validDate(value: unknown, label: string): string {
  const date = nonEmpty(value, label);
  if (!Number.isFinite(Date.parse(date))) fail(`${label} must be a valid date`);
  return date;
}
function safePath(value: unknown): string {
  const path = nonEmpty(value, "page path");
  if (
    path.startsWith("/") ||
    path.startsWith("\\") ||
    /^[a-z][a-z\d+.-]*:/i.test(path) ||
    path.includes("\\") ||
    /[?#\u0000-\u001f]/.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    fail(`Unsafe image path: ${path}`);
  return path;
}
function optionalString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  if (record[key] === undefined) return undefined;
  return nonEmpty(record[key], key);
}

export function validateImageManifest(value: unknown): ImageManifest {
  if (
    !isRecord(value) ||
    value.format !== "harmonica-image-scores" ||
    value.version !== 1 ||
    !Array.isArray(value.songs)
  )
    fail("Invalid image score manifest header");
  const ids = new Set<string>();
  const songs = value.songs.map((raw, index): ImageSong => {
    const label = `songs[${index}]`;
    if (!isRecord(raw)) fail(`${label} must be an object`);
    const id = nonEmpty(raw.id, `${label}.id`);
    if (ids.has(id)) fail(`Duplicate song id: ${id}`);
    ids.add(id);
    if (!Array.isArray(raw.pages) || raw.pages.length === 0)
      fail(`${label}.pages must be a non-empty array`);
    const pagePaths = new Set<string>();
    const pages = raw.pages.map((page, pageIndex) => {
      if (!isRecord(page))
        fail(`${label}.pages[${pageIndex}] must be an object`);
      const path = safePath(page.path);
      if (pagePaths.has(path))
        fail(`Duplicate page path for song ${id}: ${path}`);
      pagePaths.add(path);
      // Imported asset identifiers are intentionally ignored and rebuilt from song + path.
      return { assetId: imageAssetId(id, path), path };
    });
    const song: ImageSong = {
      id,
      title: nonEmpty(raw.title, `${label}.title`),
      createdAt: validDate(raw.createdAt, `${label}.createdAt`),
      updatedAt: validDate(raw.updatedAt, `${label}.updatedAt`),
      pages,
    };
    for (const key of [
      "author",
      "difficulty",
      "key",
      "lastOpenedAt",
      "bdEntryId",
    ] as const) {
      const item = optionalString(raw, key);
      if (item !== undefined)
        song[key] =
          key === "lastOpenedAt"
            ? validDate(item, `${label}.lastOpenedAt`)
            : item;
    }
    if (raw.favorite !== undefined) {
      if (typeof raw.favorite !== "boolean")
        fail(`${label}.favorite must be boolean`);
      song.favorite = raw.favorite;
    }
    if (raw.tags !== undefined) {
      if (
        !Array.isArray(raw.tags) ||
        raw.tags.some((tag) => typeof tag !== "string" || !tag.trim())
      )
        fail(`${label}.tags must be an array of non-empty strings`);
      song.tags = raw.tags.map((tag) => (tag as string).trim());
    }
    if (raw.source !== undefined) {
      if (!isRecord(raw.source)) fail(`${label}.source must be an object`);
      song.source = { name: nonEmpty(raw.source.name, `${label}.source.name`) };
      if (raw.source.url !== undefined) {
        const url = nonEmpty(raw.source.url, `${label}.source.url`);
        try {
          const parsedUrl = new URL(url);
          if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:")
            fail(`${label}.source.url must use HTTP or HTTPS`);
        } catch {
          fail(`${label}.source.url must be an HTTP or HTTPS URL`);
        }
        song.source.url = url;
      }
    }
    return song;
  });
  return { format: "harmonica-image-scores", version: 1, songs };
}

function imageAssetId(songId: string, path: string): string {
  return `image-score:${encodeURIComponent(songId)}:${encodeURIComponent(path)}`;
}
function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () =>
      reject(value.error ?? new Error("IndexedDB request failed"));
  });
}
function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error ?? new Error("Image score storage transaction failed"));
  });
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, VERSION);
    open.onupgradeneeded = () => {
      for (const name of ["songs", "assets"])
        if (!open.result.objectStoreNames.contains(name))
          open.result.createObjectStore(name, { keyPath: "id" });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () =>
      reject(open.error ?? new Error("Unable to open image score library"));
  });
}

type InputFile = File & { webkitRelativePath?: string };
function filePath(file: InputFile): string {
  const candidate = file.webkitRelativePath || file.name;
  return candidate.replace(/\\/g, "/");
}
function commonRoot(files: InputFile[]): string | null {
  const paths = files.map(filePath);
  if (paths.some((path) => !path.includes("/"))) return null;
  const roots = new Set(paths.map((path) => path.split("/")[0]));
  return roots.size === 1 ? [...roots][0]! : null;
}

export async function importImageFiles(
  files: File[],
): Promise<{ imported: number }> {
  const inputs = files as InputFile[];
  const root = commonRoot(inputs);
  const byPath = new Map<string, File>();
  for (const file of inputs) {
    let path = filePath(file);
    if (root && path.startsWith(`${root}/`)) path = path.slice(root.length + 1);
    if (byPath.has(path)) fail(`Duplicate file path: ${path}`);
    byPath.set(path, file);
  }
  const manifestFile = byPath.get("manifest.json");
  if (!manifestFile) fail("Selected files must include manifest.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await manifestFile.text());
  } catch {
    fail("manifest.json is not valid JSON");
  }
  const manifest = validateImageManifest(parsed);
  const blobByAsset = new Map<string, Blob>();
  for (const song of manifest.songs)
    for (const page of song.pages) {
      const file = byPath.get(page.path);
      if (!file) fail(`Missing image file: ${page.path}`);
      if (!IMAGE_TYPES.has(file.type.toLowerCase()))
        fail(
          `Unsupported image MIME type for ${page.path}: ${file.type || "(empty)"}`,
        );
      blobByAsset.set(page.assetId, file);
    }

  const db = await database();
  try {
    const tx = db.transaction(["songs", "assets"], "readwrite");
    const done = transactionDone(tx);
    const songsStore = tx.objectStore("songs");
    const existingReq = songsStore.getAll();
    existingReq.onerror = () => {
      try {
        tx.abort();
      } catch {
        /* already aborted */
      }
    };
    existingReq.onsuccess = () => {
      try {
        const existing = existingReq.result as ImageSong[];
        const imports = new Map(manifest.songs.map((song) => [song.id, song]));
        const retained = existing.filter((song) => !imports.has(song.id));
        for (const song of manifest.songs) {
          const prior = existing.find((item) => item.id === song.id);
          const merged = { ...song };
          if (prior?.favorite !== undefined) merged.favorite = prior.favorite;
          if (prior?.lastOpenedAt !== undefined)
            merged.lastOpenedAt = prior.lastOpenedAt;
          if (prior?.bdEntryId !== undefined)
            merged.bdEntryId = prior.bdEntryId;
          songsStore.put(merged);
        }
        const referenced = new Set(
          [...retained, ...manifest.songs].flatMap((song) =>
            song.pages.map((page) => page.assetId),
          ),
        );
        const assetsStore = tx.objectStore("assets");
        for (const old of existing.filter((song) => imports.has(song.id)))
          for (const page of old.pages)
            if (!referenced.has(page.assetId)) assetsStore.delete(page.assetId);
        for (const [id, blob] of blobByAsset) assetsStore.put({ id, blob });
      } catch {
        try {
          tx.abort();
        } catch {
          /* already completed */
        }
      }
    };
    await done;
    return { imported: manifest.songs.length };
  } finally {
    db.close();
  }
}

export async function listImageSongs(): Promise<ImageSong[]> {
  const db = await database();
  try {
    return (await request(
      db.transaction("songs").objectStore("songs").getAll(),
    )) as ImageSong[];
  } finally {
    db.close();
  }
}
export async function getScoreImage(assetId: string): Promise<Blob | null> {
  const db = await database();
  try {
    const value = (await request(
      db.transaction("assets").objectStore("assets").get(assetId),
    )) as { blob?: Blob } | undefined;
    return value?.blob ?? null;
  } finally {
    db.close();
  }
}
export async function deleteImageSong(id: string): Promise<void> {
  const db = await database();
  try {
    const tx = db.transaction(["songs", "assets"], "readwrite");
    const done = transactionDone(tx);
    const songs = tx.objectStore("songs");
    const targetReq = songs.get(id);
    targetReq.onerror = () => {
      try {
        tx.abort();
      } catch {
        /* already aborted */
      }
    };
    targetReq.onsuccess = () => {
      const target = targetReq.result as ImageSong | undefined;
      songs.delete(id);
      if (!target) return;
      const allReq = songs.getAll();
      allReq.onerror = () => {
        try {
          tx.abort();
        } catch {
          /* already aborted */
        }
      };
      allReq.onsuccess = () => {
        const used = new Set(
          (allReq.result as ImageSong[]).flatMap((song) =>
            song.pages.map((page) => page.assetId),
          ),
        );
        for (const page of target.pages)
          if (!used.has(page.assetId))
            tx.objectStore("assets").delete(page.assetId);
      };
    };
    await done;
  } finally {
    db.close();
  }
}
export async function updateImageSong(
  id: string,
  patch: { favorite?: boolean; lastOpenedAt?: string; bdEntryId?: string },
): Promise<void> {
  if (patch.favorite !== undefined && typeof patch.favorite !== "boolean")
    fail("favorite must be boolean");
  if (patch.lastOpenedAt !== undefined)
    validDate(patch.lastOpenedAt, "lastOpenedAt");
  if (patch.bdEntryId !== undefined) nonEmpty(patch.bdEntryId, "bdEntryId");
  const db = await database();
  try {
    const tx = db.transaction("songs", "readwrite");
    const done = transactionDone(tx);
    const store = tx.objectStore("songs");
    const req = store.get(id);
    req.onerror = () => {
      try {
        tx.abort();
      } catch {
        /* already aborted */
      }
    };
    req.onsuccess = () => {
      if (!req.result) {
        try {
          tx.abort();
        } catch {
          /* already aborted */
        }
        return;
      }
      store.put({ ...req.result, ...patch });
    };
    await done;
  } finally {
    db.close();
  }
}
export async function exportImageFiles(): Promise<{
  manifest: ImageManifest;
  assets: Array<{ path: string; blob: Blob }>;
}> {
  const songs = await listImageSongs();
  const db = await database();
  try {
    const tx = db.transaction("assets");
    const assetsStore = tx.objectStore("assets");
    const pairs = songs.flatMap((song) =>
      song.pages.map((page, index) => ({ song, page, index })),
    );
    const values = await Promise.all(
      pairs.map(({ page }) => request(assetsStore.get(page.assetId))),
    );
    const files: Array<{ path: string; blob: Blob }> = [];
    const exportedSongs = songs.map((song) => ({
      ...song,
      pages: [] as ImageScorePage[],
    }));
    pairs.forEach(({ song, page, index }, pairIndex) => {
      const value = values[pairIndex] as { blob?: Blob } | undefined;
      if (!value?.blob) fail(`Missing stored image: ${page.assetId}`);
      const extension = (
        {
          "image/png": "png",
          "image/jpeg": "jpg",
          "image/webp": "webp",
          "image/gif": "gif",
        } as Record<string, string>
      )[value.blob.type.toLowerCase()];
      if (!extension)
        fail(
          `Unsupported stored image MIME type: ${value.blob.type || "(empty)"}`,
        );
      const path = `scores/${encodeURIComponent(song.id)}/${String(index + 1).padStart(3, "0")}.${extension}`;
      exportedSongs
        .find((item) => item.id === song.id)!
        .pages.push({ ...page, path });
      files.push({ path, blob: value.blob });
    });
    return {
      manifest: validateImageManifest({
        format: "harmonica-image-scores",
        version: 1,
        songs: exportedSongs,
      }),
      assets: files,
    };
  } finally {
    db.close();
  }
}
