import { unzip, zip } from "fflate";
import { exportImageFiles, importImageFiles } from "./image-score-library.ts";

const MAX_BYTES = 750 * 1024 * 1024;
/** ZIP is an explicit local transfer, never a remote asset loader. */
export async function importScoreZip(
  file: File,
): Promise<{ imported: number }> {
  if (file.size > MAX_BYTES) throw new Error("谱包超过 750 MB，请分批导入。");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const extracted = await new Promise<Record<string, Uint8Array>>(
    (resolve, reject) => {
      let total = 0;
      let count = 0;
      let limit = false;
      unzip(
        bytes,
        {
          filter: (entry) => {
            total += entry.originalSize;
            count++;
            if (total > MAX_BYTES || count > 10000) limit = true;
            return !limit && !entry.name.endsWith("/");
          },
        },
        (error, result) => {
          if (limit) reject(new Error("解压后谱包过大，请分批导入。"));
          else if (error) reject(new Error("无法读取 ZIP 谱包。"));
          else resolve(result);
        },
      );
    },
  );
  const mime: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    json: "application/json",
  };
  const files = Object.entries(extracted).map(([path, data]) => {
    const item = new File([new Uint8Array(data)], path.split("/").at(-1)!, {
      type: mime[path.split(".").at(-1)!.toLowerCase()] || "",
    });
    Object.defineProperty(item, "webkitRelativePath", { value: path });
    return item;
  });
  return importImageFiles(files);
}
export async function exportScoreZip(): Promise<Blob> {
  const { manifest, assets } = await exportImageFiles();
  if (!manifest.songs.length) throw new Error("尚无图片谱可备份。");
  if (assets.reduce((sum, a) => sum + a.blob.size, 0) > MAX_BYTES)
    throw new Error("谱库超过单次备份上限 750 MB，请保留原始谱包。");
  const files: Record<string, Uint8Array> = {
    "manifest.json": new TextEncoder().encode(
      JSON.stringify(manifest, null, 2),
    ),
  };
  for (const asset of assets)
    files[asset.path] = new Uint8Array(await asset.blob.arrayBuffer());
  return new Promise((resolve, reject) =>
    zip(files, { level: 0 }, (error, data) =>
      error
        ? reject(error)
        : resolve(
            new Blob([new Uint8Array(data)], { type: "application/zip" }),
          ),
    ),
  );
}
