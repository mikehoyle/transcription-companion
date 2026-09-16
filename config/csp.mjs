// The single source of truth for the Content-Security-Policy.
//
// It is served from three places, none of which can read this file at runtime:
// `npm run preview` (vite.config.ts imports it), nginx in the Docker image and
// Cloudflare Pages. `scripts/gen-headers.mjs` generates nginx.conf and
// public/_headers from this constant so the copies cannot drift.
//
// - blob: in script-src is required because signalsmith-stretch loads its
//   AudioWorklet module from a Blob URL.
// - 'wasm-unsafe-eval' allows WebAssembly compilation (stretch + ffmpeg).
export const CSP = [
  "default-src 'self'",
  "script-src 'self' blob: 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' blob: data:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');
