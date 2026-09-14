// Copies the ffmpeg.wasm core into public/ so it is served as static files and
// only downloaded when a file can't be decoded natively by the browser.
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const dest = join(root, 'public', 'ffmpeg');

mkdirSync(dest, { recursive: true });
for (const name of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  const from = join(src, name);
  const to = join(dest, name);
  if (!existsSync(from)) {
    console.error(`Missing ${from}. Did you run npm install?`);
    process.exit(1);
  }
  if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
  copyFileSync(from, to);
  console.log(`copied ${name}`);
}
