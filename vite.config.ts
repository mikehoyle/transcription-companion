import { createServer, defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
// Shared with nginx.conf and public/_headers, which scripts/gen-headers.mjs
// generates from it, so `npm run preview` exercises the production policy.
import { CSP } from './config/csp.mjs';

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
