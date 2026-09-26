#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";

const CONCURRENCY = 3;
const RETRIES = 1;
const ALLOWED_HOSTS = new Set(["pic1.afdiancdn.com"]);

function args(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    const value = argv[++i];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${key}`);
    result[key.slice(2)] = value;
  }
  return result;
}

function dateFrom(value, label) {
  const date =
    typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new Error(`Invalid ${label} date: ${value}`);
  return date.toISOString();
}

function imageType(bytes, contentType) {
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (bytes[0] === 0x89 && bytes.toString("ascii", 1, 4) === "PNG")
    return "image/png";
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (bytes.toString("ascii", 0, 3) === "GIF") return "image/gif";
  throw new Error(
    `Response is not an image (content-type: ${type || "missing"})`,
  );
}

function extension(type) {
  return (
    {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
    }[type] ?? "img"
  );
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fetchImage(url) {
  let lastError;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        redirect: "error",
        credentials: "omit",
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const type = imageType(bytes, response.headers.get("content-type") ?? "");
      return { bytes, type };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function mapLimit(items, limit, task) {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const index = next++;
        if (index >= items.length) return;
        await task(items[index], index);
      }
    },
  );
  await Promise.all(workers);
}

async function main() {
  const options = args(process.argv.slice(2));
  if (!options.index || !options.output)
    throw new Error(
      "Usage: node scripts/prepare-image-scores.mjs --index <source-index.json> --output <directory>",
    );
  const indexPath = path.resolve(options.index);
  const outputDir = path.resolve(options.output);
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  if (
    !Array.isArray(index.posts) ||
    typeof index.albumUrl !== "string" ||
    !index.retrievedAt
  )
    throw new Error("Index must provide albumUrl, retrievedAt, and posts[]");

  const skipped = index.posts
    .filter((post) => post.hasRight !== 1 || post.canCopy !== 1)
    .map(({ id, title, hasRight, canCopy }) => ({
      id,
      title,
      reason: "not authorized for local copying",
      hasRight,
      canCopy,
    }));
  const eligible = index.posts.filter(
    (post) => post.hasRight === 1 && post.canCopy === 1,
  );
  const failures = [];
  const songs = [];
  let downloaded = 0;
  let reused = 0;
  let totalBytes = 0;
  const cachePath = path.join(outputDir, "download-cache.json");
  let cache = { version: 1, files: {} };
  try {
    const saved = JSON.parse(await readFile(cachePath, "utf8"));
    if (saved.version === 1 && saved.files && typeof saved.files === "object")
      cache = saved;
  } catch (error) {
    if (error?.code !== "ENOENT") throw new Error(`Invalid download cache: ${error.message}`);
  }
  const updatedAt = dateFrom(index.retrievedAt, "retrieved");

  await mapLimit(eligible, CONCURRENCY, async (post) => {
    try {
      if (!/^[a-zA-Z0-9_-]+$/.test(String(post.id)))
        throw new Error("Invalid post id");
      if (!Array.isArray(post.pics) || !post.pics.length) {
        skipped.push({ id: post.id, title: post.title, reason: "no source image pages" });
        return;
      }
      const pages = [];
      for (let i = 0; i < post.pics.length; i++) {
        const sourceUrl = new URL(post.pics[i]);
        if (
          sourceUrl.protocol !== "https:" ||
          !ALLOWED_HOSTS.has(sourceUrl.hostname)
        )
          throw new Error(
            `Image URL host is not approved: ${sourceUrl.hostname}`,
          );
        const directory = path.join(outputDir, "scores", String(post.id));
        const base = String(i + 1).padStart(3, "0");
        const slot = `scores/${post.id}/${base}`;
        const oldFiles = Object.keys(cache.files).filter((filePath) => filePath.startsWith(`${slot}.`));
        let cachedFile = null;
        let bytes = null;
        let type = null;
        for (const filePath of oldFiles) {
          const record = cache.files[filePath];
          if (record?.sourceUrl !== sourceUrl.href) continue;
          try {
            const candidate = await readFile(path.join(outputDir, filePath));
            const candidateType = imageType(candidate, "");
            if (sha256(candidate) === record.sha256) {
              cachedFile = filePath;
              bytes = candidate;
              type = candidateType;
              break;
            }
          } catch {
            // A missing, altered, or invalid cached file is downloaded again.
          }
        }
        let filePath;
        if (bytes) {
          filePath = cachedFile;
          reused++;
        } else {
          const result = await fetchImage(sourceUrl.href);
          bytes = result.bytes;
          type = result.type;
          filePath = `${slot}.${extension(type)}`;
          const file = path.join(outputDir, filePath);
          await mkdir(path.dirname(file), { recursive: true });
          await writeFile(file, bytes);
          for (const oldPath of oldFiles) {
            if (oldPath !== filePath) await unlink(path.join(outputDir, oldPath)).catch(() => undefined);
            delete cache.files[oldPath];
          }
          cache.files[filePath] = { sourceUrl: sourceUrl.href, sha256: sha256(bytes) };
          downloaded++;
        }
        pages.push({
          assetId: `afdian-${post.id}-${base}`,
          path: filePath,
        });
        totalBytes += bytes.byteLength;
      }
      const title = String(post.title ?? "")
        .replace(/^【半音阶口琴】\s*/, "")
        .trim();
      songs.push({
        id: `afdian-${post.id}`,
        title: title || `未命名曲谱 ${post.id}`,
        source: {
          name: String(post.source ?? "熊猫哨笛馆"),
          url: `${index.albumUrl.replace(/\/$/, "")}/${post.id}`,
        },
        tags: ["半音阶口琴"],
        createdAt: dateFrom(post.published, "published"),
        updatedAt,
        pages,
      });
    } catch (error) {
      failures.push({
        id: post.id,
        title: post.title,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  songs.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
  const manifest = { format: "harmonica-image-scores", version: 1, songs };
  await writeFile(
    path.join(outputDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  const report = {
    eligible: eligible.length,
    included: songs.length,
    skipped,
    failures,
    downloaded,
    reused,
    totalBytes,
  };
  await writeFile(
    path.join(outputDir, "prepare-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  const zipEntries = {
    "manifest.json": strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
  };
  for (const song of songs)
    for (const page of song.pages)
      zipEntries[page.path] = new Uint8Array(
        await readFile(path.join(outputDir, page.path)),
      );
  await writeFile(
    path.join(outputDir, "panda-chromatic.zip"),
    zipSync(zipEntries, { level: 6 }),
  );
  console.log(
    JSON.stringify(
      {
        ...report,
        manifest: path.join(outputDir, "manifest.json"),
        zip: path.join(outputDir, "panda-chromatic.zip"),
      },
      null,
      2,
    ),
  );
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
