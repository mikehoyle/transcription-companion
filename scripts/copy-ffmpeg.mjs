// Copies the ffmpeg.wasm core into public/ffmpeg/<version>/ so it is served as
// static files and only downloaded when a file can't be decoded natively.
//
// The ~32 MB wasm binary is split into parts because static hosts cap file
// size (Cloudflare Pages: 25 MiB per asset). The browser fetches the parts
// listed in public/ffmpeg/manifest.json and reassembles them.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PART_SIZE = 10 * 1024 * 1024;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'node_modules', '@ffmpeg', 'core');
const src = join(pkgDir, 'dist', 'esm');
const outRoot = join(root, 'public', 'ffmpeg');

if (!existsSync(join(src, 'ffmpeg-core.wasm'))) {
  console.error(`Missing ${src}. Did you run npm install?`);
  process.exit(1);
}

const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
const wasmSize = statSync(join(src, 'ffmpeg-core.wasm')).size;
const manifestPath = join(outRoot, 'manifest.json');

// Up to date already?
if (existsSync(manifestPath)) {
  try {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const files = [m.core, ...m.wasmParts].map((f) => join(outRoot, f));
    if (m.version === version && m.wasmSize === wasmSize && files.every((f) => existsSync(f))) process.exit(0);
  } catch {
    // fall through and regenerate
  }
}

rmSync(outRoot, { recursive: true, force: true });
const outDir = join(outRoot, version);
mkdirSync(outDir, { recursive: true });

copyFileSync(join(src, 'ffmpeg-core.js'), join(outDir, 'ffmpeg-core.js'));

const wasm = readFileSync(join(src, 'ffmpeg-core.wasm'));
const wasmParts = [];
for (let i = 0, n = 0; i < wasm.length; i += PART_SIZE, n++) {
  const name = `ffmpeg-core.wasm.${String(n).padStart(3, '0')}`;
  writeFileSync(join(outDir, name), wasm.subarray(i, i + PART_SIZE));
  wasmParts.push(`${version}/${name}`);
}

const manifest = { version, core: `${version}/ffmpeg-core.js`, wasmParts, wasmSize };
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`ffmpeg core ${version}: copied, wasm split into ${wasmParts.length} parts`);
