import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'public', 'logo-opalapa.png');
const tmp = path.join(root, 'public', 'logo-opalapa.tmp.png');

const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
const out = Buffer.from(data);

for (let i = 0; i < width * height; i += 1) {
  const o = i * channels;
  const r = out[o];
  const g = out[o + 1];
  const b = out[o + 2];
  if (r < 28 && g < 28 && b < 28) {
    out[o + 3] = 0;
  }
}

let minX = width;
let minY = height;
let maxX = 0;
let maxY = 0;
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const o = (y * width + x) * channels;
    if (out[o + 3] > 8) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
}

const pad = 2;
const left = Math.max(0, minX - pad);
const top = Math.max(0, minY - pad);
const extractW = Math.min(width - left, maxX - minX + 1 + pad * 2);
const extractH = Math.min(height - top, maxY - minY + 1 + pad * 2);

await sharp(out, { raw: { width, height, channels } })
  .extract({ left, top, width: extractW, height: extractH })
  .png()
  .toFile(tmp);

await fs.rename(tmp, file);

console.log(`Logo atualizada: ${extractW}x${extractH}px`);
