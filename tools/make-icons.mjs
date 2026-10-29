// Erzeugt src/icons/icon-*.png (Wellenform-Balken auf dunklem Grund). Einmalig ausführen: node tools/make-icons.mjs
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../src/icons/', import.meta.url));
mkdirSync(out, { recursive: true });

const BARS = [0.3, 0.6, 1, 0.7, 0.45, 0.8, 0.35];

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0);
  return Buffer.concat([head, data, crc]);
}

function png(size) {
  const px = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  const inside = (x, y) => {
    const dx = Math.max(radius - x, 0, x - (size - 1 - radius));
    const dy = Math.max(radius - y, 0, y - (size - 1 - radius));
    return dx * dx + dy * dy <= radius * radius;
  };
  const slot = size / (BARS.length + 1);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      if (!inside(x, y)) continue;
      let color = [31, 41, 55];
      const i = Math.floor((x - slot * 0.5) / slot);
      if (i >= 0 && i < BARS.length && Math.abs(((x - slot * 0.5) % slot) - slot / 2) < slot * 0.3) {
        const half = (BARS[i] * size * 0.7) / 2;
        if (Math.abs(y - size / 2) <= half) color = [239, 68, 68];
      }
      px.set([...color, 255], o);
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

for (const size of [16, 32, 48, 128]) writeFileSync(`${out}icon-${size}.png`, png(size));
console.log('Icons geschrieben');
