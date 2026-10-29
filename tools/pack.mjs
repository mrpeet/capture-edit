// Baut dist/ neu und packt je Browser ein ZIP nach release/ (ohne Zusatzprogramme).
// chrome  -> für "Entpackt laden" (entpacken) oder den Chrome Web Store
// firefox -> temporär laden (about:debugging) oder bei addons.mozilla.org einreichen
import { execFileSync } from 'node:child_process';
import { deflateRawSync, crc32 } from 'node:zlib';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
execFileSync(process.execPath, [join(root, 'tools/build.mjs')], { stdio: 'inherit' });

const { version } = JSON.parse(readFileSync(join(root, 'manifests/chrome.json'), 'utf8'));

function files(dir, rel = '') {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    const path = posix.join(rel, name);
    return statSync(full).isDirectory() ? files(full, path) : [{ full, path }];
  });
}

function zip(dir) {
  const parts = [];
  const central = [];
  let offset = 0;
  const d = new Date(2024, 0, 1); // fester Zeitstempel, damit gleiche Inhalte gleiche ZIPs ergeben
  const time = (d.getHours() << 11) | (d.getMinutes() << 5);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const { full, path } of files(dir)) {
    const data = readFileSync(full);
    const packed = deflateRawSync(data);
    const name = Buffer.from(path);
    const crc = crc32(data) >>> 0;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // UTF-8-Dateinamen
    head.writeUInt16LE(8, 8);
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(name.length, 26);
    parts.push(head, name, packed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(time, 12);
    c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(packed.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += head.length + name.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

rmSync(join(root, 'release'), { recursive: true, force: true });
mkdirSync(join(root, 'release'));
for (const target of ['chrome', 'firefox']) {
  const out = join(root, `release/captureedit-${target}-v${version}.zip`);
  writeFileSync(out, zip(join(root, `dist/${target}`)));
  console.log(`release/captureedit-${target}-v${version}.zip`);
}
