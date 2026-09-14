import {
  importBdText,
  validateNoteSequence,
  type NoteSequence,
} from "./score/index.ts";
import type { Key } from "./lib/harmonica.ts";

export type DraftLine = {
  id: string;
  kind: "bd" | "lyrics" | "ignore";
  original: string;
  edited: string;
  confirmed: boolean;
};
export type ScoreDraft = {
  version: 1;
  id: string;
  title: string;
  sourceKey: Key | "";
  assetId: string;
  imageName: string;
  createdAt: string;
  updatedAt: string;
  ocrOriginal: string;
  lines: DraftLine[];
  fullImageConfirmed: boolean;
};
export type LibraryEntry = {
  version: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  assetId: string;
  draftId?: string;
  reviewSummary?: string;
  sequence: NoteSequence;
};

const DB = "harmonica-score-library",
  VERSION = 1;
function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () =>
      reject(value.error ?? new Error("IndexedDB request failed"));
  });
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      for (const name of ["drafts", "assets", "entries"] as const)
        if (!db.objectStoreNames.contains(name))
          db.createObjectStore(name, { keyPath: "id" });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("无法打开本地谱库"));
  });
}
function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(transaction.error ?? new Error("本地存储写入失败"));
  });
}
function abort(transaction: IDBTransaction): void {
  try {
    transaction.abort();
  } catch {
    // The transaction may already have completed or aborted.
  }
}
async function all<T>(store: "drafts" | "entries"): Promise<T[]> {
  const db = await database();
  try {
    return (await request(
      db.transaction(store).objectStore(store).getAll(),
    )) as T[];
  } finally {
    db.close();
  }
}
async function get<T>(
  store: "drafts" | "entries",
  id: string,
): Promise<T | null> {
  const db = await database();
  try {
    return (
      ((await request(db.transaction(store).objectStore(store).get(id))) as
        T | undefined) ?? null
    );
  } finally {
    db.close();
  }
}
async function put(
  store: "drafts" | "assets" | "entries",
  value: unknown,
): Promise<void> {
  const db = await database();
  try {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    await transactionDone(tx);
  } finally {
    db.close();
  }
}
export const newId = () => crypto.randomUUID();
export async function saveDraft(
  draft: ScoreDraft,
  image?: Blob,
): Promise<void> {
  const db = await database();
  try {
    const tx = db.transaction(["drafts", "assets"], "readwrite");
    const done = transactionDone(tx);
    try {
      if (image)
        tx.objectStore("assets").put({
          id: draft.assetId,
          blob: image,
          name: draft.imageName,
        });
      tx.objectStore("drafts").put(draft);
    } catch (error) {
      abort(tx);
      await done.catch(() => undefined);
      throw error;
    }
    await done;
  } finally {
    db.close();
  }
}
export const listDrafts = () => all<ScoreDraft>("drafts");
export const getDraft = (id: string) => get<ScoreDraft>("drafts", id);
export async function getImage(assetId: string): Promise<Blob | null> {
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
export const listEntries = () => all<LibraryEntry>("entries");
export async function deleteDraft(id: string): Promise<void> {
  await deleteReferenced("drafts", id);
}
export async function deleteEntry(id: string): Promise<void> {
  await deleteReferenced("entries", id);
}
async function deleteReferenced(
  store: "drafts" | "entries",
  id: string,
): Promise<void> {
  const db = await database();
  try {
    const tx = db.transaction(["drafts", "entries", "assets"], "readwrite");
    const done = transactionDone(tx);
    const targetRequest = tx.objectStore(store).get(id);
    targetRequest.onerror = () => abort(tx);
    targetRequest.onsuccess = () => {
      const target = targetRequest.result as { assetId?: string } | undefined;
      if (!target?.assetId) {
        tx.objectStore(store).delete(id);
        return;
      }
      const assetId = target.assetId;
      const draftsRequest = tx.objectStore("drafts").getAll();
      const entriesRequest = tx.objectStore("entries").getAll();
      draftsRequest.onerror = entriesRequest.onerror = () => abort(tx);
      entriesRequest.onsuccess = () => {
        const drafts = (
          draftsRequest.result as { id: string; assetId: string }[]
        ).filter((item) => !(store === "drafts" && item.id === id));
        const entries = (
          entriesRequest.result as { id: string; assetId: string }[]
        ).filter((item) => !(store === "entries" && item.id === id));
        tx.objectStore(store).delete(id);
        if (
          !drafts.some((item) => item.assetId === assetId) &&
          !entries.some((item) => item.assetId === assetId)
        )
          tx.objectStore("assets").delete(assetId);
      };
    };
    await done;
  } finally {
    db.close();
  }
}

export function makeSequence(draft: ScoreDraft): {
  sequence: NoteSequence | null;
  errors: string[];
} {
  if (!draft.sourceKey)
    return { sequence: null, errors: ["请明确选择原谱口琴调。"] };
  if (!draft.fullImageConfirmed)
    return { sequence: null, errors: ["请确认已对照原图检查无漏行。"] };
  const unconfirmed = draft.lines.filter((line) => !line.confirmed);
  if (unconfirmed.length)
    return { sequence: null, errors: ["请逐行确认所有 BD、歌词和忽略行。"] };
  const bd = draft.lines
    .filter((line) => line.kind === "bd")
    .map((line) => line.edited)
    .join("\n");
  const result = importBdText(bd, {
    sourceKey: draft.sourceKey,
    title: draft.title || "未命名图片谱",
  });
  const nonBdText = result.diagnostics.filter(
    (item) => item.code === "UNALIGNED_TEXT",
  );
  if (!result.sequence || nonBdText.length)
    return {
      sequence: null,
      errors: result.sequence
        ? nonBdText.map(
            (item) =>
              `BD第${item.line}行第${item.column}列：${item.message}；请拆分为歌词/文字行。`,
          )
        : result.diagnostics
            .filter((item) => item.severity === "error")
            .map(
              (item) =>
                `BD第${item.line}行第${item.column}列（${item.token}）：${item.message}`,
            ),
    };
  const sequence = result.sequence;
  sequence.lyrics = draft.lines
    .filter((line) => line.kind === "lyrics" && line.edited.trim())
    .map((line, index) => ({
      id: `image-lyric-${index + 1}`,
      text: line.edited,
      eventIds: [],
      alignment: "unassigned" as const,
      sourceRef: {
        sourceId: "image-source-1",
        token: line.original,
      },
    }));
  sequence.sources.push({
    id: "image-source-1",
    format: "image",
    rawText: draft.ocrOriginal,
  });
  const checked = validateNoteSequence(sequence);
  return checked.valid
    ? { sequence, errors: [] }
    : { sequence: null, errors: checked.errors };
}
export async function saveConfirmedDraft(
  draft: ScoreDraft,
): Promise<LibraryEntry> {
  const made = makeSequence(draft);
  if (!made.sequence) throw new Error(made.errors.join(" "));
  const now = new Date().toISOString();
  const entry: LibraryEntry = {
    version: 1,
    id: newId(),
    title: made.sequence.title,
    createdAt: now,
    updatedAt: now,
    assetId: draft.assetId,
    draftId: draft.id,
    reviewSummary: "已逐行确认，并对照原图检查无漏行。",
    sequence: made.sequence,
  };
  await put("entries", entry);
  return entry;
}
export function validateLibraryBackup(value: unknown): {
  entries: LibraryEntry[];
  errors: string[];
} {
  const direct = validateNoteSequence(value);
  if (direct.valid) {
    const sequence = value as NoteSequence;
    return {
      entries: [
        {
          version: 1,
          id: newId(),
          title: sequence.title,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          assetId: "",
          sequence,
        },
      ],
      errors: [],
    };
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    !Array.isArray((value as { entries?: unknown }).entries)
  )
    return {
      entries: [],
      errors: [
        "备份必须是 schemaVersion 为 1 的 entries JSON，或单首有效 NoteSequence。",
      ],
    };
  const entries: LibraryEntry[] = [];
  const errors: string[] = [];
  for (const candidate of (value as { entries: unknown[] }).entries) {
    const item =
      candidate && typeof candidate === "object"
        ? (candidate as Partial<LibraryEntry>)
        : {};
    const checked = validateNoteSequence(item.sequence);
    const dates =
      typeof item.createdAt === "string" &&
      Number.isFinite(Date.parse(item.createdAt)) &&
      typeof item.updatedAt === "string" &&
      Number.isFinite(Date.parse(item.updatedAt));
    if (
      item.version !== 1 ||
      typeof item.id !== "string" ||
      typeof item.title !== "string" ||
      typeof item.assetId !== "string" ||
      !dates ||
      !checked.valid
    )
      errors.push(
        `无效歌曲：${typeof item.title === "string" ? item.title : "未命名"}（${checked.errors.join("；")}）`,
      );
    else
      entries.push({
        ...(item as LibraryEntry),
        assetId: "",
        draftId: undefined,
      });
  }
  return { entries, errors };
}
export async function importEntries(entries: LibraryEntry[]): Promise<void> {
  for (const entry of entries) {
    const checked = validateNoteSequence(entry?.sequence);
    if (!entry || entry.version !== 1 || !checked.valid)
      throw new Error(`无效歌曲：${entry?.title ?? "未命名"}`);
  }
  if (!entries.length) return;
  const db = await database();
  try {
    const tx = db.transaction("entries", "readwrite");
    const done = transactionDone(tx);
    try {
      for (const entry of entries)
        tx.objectStore("entries").add({
          ...entry,
          id: newId(),
          assetId: "",
          draftId: undefined,
        });
    } catch (error) {
      abort(tx);
      await done.catch(() => undefined);
      throw error;
    }
    await done;
  } finally {
    db.close();
  }
}
