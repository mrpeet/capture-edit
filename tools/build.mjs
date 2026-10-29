// Baut dist/chrome (Brave/Chrome) und dist/firefox aus src/ + manifests/.
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const targets = { chrome: 'chrome.json', firefox: 'firefox.json' };

rmSync(`${root}dist`, { recursive: true, force: true });
for (const [name, manifest] of Object.entries(targets)) {
  const out = `${root}dist/${name}`;
  mkdirSync(out, { recursive: true });
  cpSync(`${root}src`, out, { recursive: true });
  const json = JSON.parse(readFileSync(`${root}manifests/${manifest}`, 'utf8'));
  writeFileSync(`${out}/manifest.json`, JSON.stringify(json, null, 2));
  console.log(`dist/${name}`);
}
