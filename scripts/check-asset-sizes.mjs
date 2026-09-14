// Fails the build if any output file would be rejected by the static host.
// Cloudflare Pages: max 25 MiB per asset, 20,000 files (free plan).
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 20_000;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else files.push({ path: relative(dist, p), size: statSync(p).size });
  }
};
walk(dist);

const tooBig = files.filter((f) => f.size >= MAX_FILE_BYTES);
let failed = false;
if (tooBig.length) {
  failed = true;
  for (const f of tooBig) console.error(`✗ ${f.path} is ${(f.size / 1024 / 1024).toFixed(1)} MiB (limit 25 MiB)`);
}
if (files.length > MAX_FILES) {
  failed = true;
  console.error(`✗ ${files.length} files in dist (limit ${MAX_FILES})`);
}
if (failed) process.exit(1);

const largest = files.reduce((a, b) => (b.size > a.size ? b : a));
console.log(`✓ ${files.length} files, largest ${largest.path} (${(largest.size / 1024 / 1024).toFixed(1)} MiB) — within Cloudflare Pages limits`);
