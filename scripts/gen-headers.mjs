// Generates the header files that serve the Content-Security-Policy from the
// single constant in config/csp.mjs, so the copies can't drift apart:
//
//   config/nginx.conf.tmpl -> nginx.conf        (Docker / nginx)
//   config/_headers.tmpl   -> public/_headers   (Cloudflare Pages)
//
// Run by `prebuild`; `--check` instead fails if the committed files are stale,
// which is what CI runs.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSP } from '../config/csp.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const OUTPUTS = [
  { template: 'config/nginx.conf.tmpl', output: 'nginx.conf' },
  { template: 'config/_headers.tmpl', output: 'public/_headers' },
];

const banner = (template) =>
  [`# Generated from ${template} by scripts/gen-headers.mjs — do not edit.`, '# Change the policy in config/csp.mjs, then run `npm run headers`.', ''].join('\n');

const stale = [];
for (const { template, output } of OUTPUTS) {
  const wanted = banner(template) + readFileSync(join(root, template), 'utf8').replaceAll('{{CSP}}', CSP);
  let current = null;
  try {
    current = readFileSync(join(root, output), 'utf8');
  } catch {}
  if (current === wanted) continue;
  if (check) stale.push(output);
  else {
    writeFileSync(join(root, output), wanted);
    console.log(`✓ wrote ${output}`);
  }
}

if (stale.length) {
  console.error(`✗ ${stale.join(' and ')} ${stale.length > 1 ? 'are' : 'is'} out of date — run \`npm run headers\` and commit the result.`);
  process.exit(1);
}
if (check) console.log('✓ nginx.conf and public/_headers match config/csp.mjs');
