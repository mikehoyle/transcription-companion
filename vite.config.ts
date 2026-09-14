import { createServer, defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Renders the initial (welcome) screen into index.html at build time so search
// engines and link previews see real content without running JavaScript.
// main.tsx hydrates it.
function prerender(): Plugin {
  return {
    name: 'prerender-welcome',
    apply: 'build',
    async transformIndexHtml(html) {
      const server = await createServer({
        appType: 'custom',
        logLevel: 'error',
        server: { middlewareMode: true, hmr: false },
      });
      try {
        const { render } = await server.ssrLoadModule('/src/prerender.tsx');
        const out = html.replace('<div id="root"></div>', `<div id="root">${render()}</div>`);
        if (out === html) throw new Error('prerender: <div id="root"></div> not found in index.html');
        return out;
      } finally {
        await server.close();
      }
    },
  };
}

// Mirrors the Content-Security-Policy served in production — keep in sync with
// nginx.conf (Docker) and public/_headers (Cloudflare Pages) — so that
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
  plugins: [react(), prerender()],
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
