import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';

const publicDir = new URL('../public/', import.meta.url);
await mkdir(publicDir, { recursive: true });

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const typeBytes = new TextEncoder().encode(type), payload = new Uint8Array(typeBytes.length + data.length);
  payload.set(typeBytes); payload.set(data, typeBytes.length);
  const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer);
  view.setUint32(0, data.length); out.set(payload, 4); view.setUint32(out.length - 4, crc32(payload));
  return out;
}
function png(size) {
  const pixels = new Uint8Array((size * 4 + 1) * size);
  const paint = (x, y, r, g, b, a = 255) => { if (x < 0 || y < 0 || x >= size || y >= size) return; const at = y * (size * 4 + 1) + 1 + x * 4; pixels[at] = r; pixels[at + 1] = g; pixels[at + 2] = b; pixels[at + 3] = a; };
  for (let y = 0; y < size; y += 1) { pixels[y * (size * 4 + 1)] = 0; for (let x = 0; x < size; x += 1) paint(x, y, 13, 25, 23); }
  const inset = Math.round(size * .1), top = Math.round(size * .31), bottom = Math.round(size * .69), radius = Math.round(size * .08);
  for (let y = top; y <= bottom; y += 1) for (let x = inset; x < size - inset; x += 1) { const corner = (x < inset + radius && y < top + radius) || (x < inset + radius && y > bottom - radius) || (x > size - inset - radius && y < top + radius) || (x > size - inset - radius && y > bottom - radius); if (!corner || (x - (x < size / 2 ? inset + radius : size - inset - radius)) ** 2 + (y - (y < size / 2 ? top + radius : bottom - radius)) ** 2 <= radius ** 2) paint(x, y, 215, 183, 108); }
  for (let hole = 0; hole < 10; hole += 1) { const cx = Math.round(size * (.16 + hole * .075)), cy = Math.round(size * .5), r = Math.max(2, Math.round(size * .018)); for (let y = cy - r; y <= cy + r; y += 1) for (let x = cx - r; x <= cx + r; x += 1) if ((x - cx) ** 2 + (y - cy) ** 2 <= r ** 2) paint(x, y, 48, 39, 16); }
  const header = new Uint8Array(13), h = new DataView(header.buffer); h.setUint32(0, size); h.setUint32(4, size); header[8] = 8; header[9] = 6;
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), pieces = [signature, chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', new Uint8Array())];
  return Buffer.concat(pieces);
}
for (const size of [180, 192, 512]) await writeFile(new URL(`icon-${size}.png`, publicDir), png(size));
