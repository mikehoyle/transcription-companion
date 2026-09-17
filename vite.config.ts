import { createServer, defineConfig, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
// Shared with nginx.conf and public/_headers, which scripts/gen-headers.mjs
// generates from it, so `npm run preview` exercises the production policy.
import { CSP } from './config/csp.mjs';

/** Page path -> the export of src/prerender.tsx that renders its initial screen. */
const PRERENDERED: Record<string, string> = {
  '/index.html': 'render',
  '/tuner/index.html': 'renderTuner',
};

// Renders each page's initial screen into its HTML at build time so search engines and
// link previews see real content without running JavaScript. main.tsx / tuner.tsx hydrate it.
function prerender(): Plugin {
  // One server for the whole build: transformIndexHtml runs once per page.
  let server: Promise<ViteDevServer> | null = null;
  return {
    name: 'prerender',
    apply: 'build',
    async transformIndexHtml(html, ctx) {
      const name = PRERENDERED[ctx.path];
      if (!name) return;
      server ??= createServer({ appType: 'custom', logLevel: 'error', server: { middlewareMode: true, hmr: false } });
      const mod = await (await server).ssrLoadModule('/src/prerender.tsx');
      const out = html.replace('<div id="root"></div>', `<div id="root">${(mod[name] as () => string)()}</div>`);
      if (out === html) throw new Error(`prerender: <div id="root"></div> not found in ${ctx.path}`);
      return out;
    },
    async closeBundle() {
      await (await server)?.close();
      server = null;
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
    rollupOptions: {
      // Multi-page: the tuner is its own page so it can be popped out into a window of
      // its own and loads none of the player's code.
      input: { main: 'index.html', tuner: 'tuner/index.html' },
    },
  },
  preview: {
    headers: {
      'Content-Security-Policy': CSP,
    },
  },
});
