import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Mirrors the Content-Security-Policy served by nginx in production so that
// `npm run preview` exercises the same restrictions.
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

export default defineConfig({
  base: './',
  plugins: [react()],
  optimizeDeps: {
    // ffmpeg.wasm spawns its worker via `new URL(..., import.meta.url)`,
    // which breaks when pre-bundled.
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1024,
  },
  preview: {
    headers: {
      'Content-Security-Policy': CSP,
    },
  },
});
