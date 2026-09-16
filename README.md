# Learn By Ear Transcription Companion

A browser-based practice and transcription tool for learning music by ear: slow recordings down, loop
tricky passages, transpose, and see which notes and chords are sounding.

**Everything runs locally in the browser.** There is no backend: audio is decoded, stretched, analysed and
exported on your machine, and nothing is uploaded or persisted. The container only serves static files.

## Features

| Area | What you get |
| --- | --- |
| **Files** | Drag & drop or open audio *and video* files. Native browser decoding (MP3, WAV, FLAC, AAC/M4A, OGG, Opus, WebM, MP4…) with an automatic, lazily loaded **ffmpeg.wasm** fallback for everything else (AIFF, WMA, ALAC, APE, WavPack, AC3, AMR, MKV, AVI…). Videos are shown in sync with the stretched audio. |
| **Speed** | 5 %–400 % without changing pitch (Signalsmith Stretch, WASM/AudioWorklet), presets, keyboard nudges. |
| **Pitch** | Transpose ±24 semitones, fine-tune ±100 cents (match recordings not at A=440), optional formant preservation for vocals. |
| **Looping** | Drag on the waveform to create an A–B loop, drag its edges, nudge by 10/100 ms, halve/double, jump to previous/next phrase, pause between repeats, save & recall named loops, loop between markers, snap to beats. |
| **Speed trainer** | Step speed from a start to a target value by N % every N loop repetitions. |
| **Count-in & metronome** | Audible count-in before playing and/or before each loop repeat; metronome click that follows the beat grid at any speed. |
| **Tempo & key** | Automatic BPM & beat-phase detection, tap tempo, halve/double, “set bar 1 here”, beat grid with bar numbers, key estimation. |
| **Note & chord guessing** | Live pitch spectrum at the playhead drawn on an 88-key keyboard with guessed notes and chord name (incl. slash chords); click keys for a reference tone. Transposing-instrument display (B♭, E♭, F, guitar). |
| **Pitch roll & chord lane** | Whole-song constant-semitone spectrogram aligned with the waveform, plus an automatic chord timeline. |
| **Isolate parts** | 6-band parametric EQ with draggable response curve, high/low-pass filters, instrument presets; stereo / mono / left / right / swap / karaoke (centre cancel, with bass restore); balance & volume. |
| **Markers** | Tap markers while listening, rename, drag, jump with 1–9, loop from a marker to the next. |
| **Export** | Render the loop or whole file to WAV with the current speed, pitch, channel and EQ settings. |
| **Sessions** | Markers, loops, tempo and settings are autosaved per file in the browser (localStorage) and restored when you reopen it; the last opened file (up to 100 MB) is kept in IndexedDB and reopened on your next visit. Sessions can also be saved/loaded as a small JSON file. |
| **Keyboard** | Extensive shortcuts — press `?` in the app for the full list. |

## Running locally

Requires Node 22.12+ (see `.nvmrc`).

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm test           # run the unit tests once
npm run test:watch # re-run them as you edit
```

```bash
npm run build      # type-check + static build into dist/
npm run preview    # serve dist/ with the production Content-Security-Policy
```

`npm run dev`/`build` automatically copy the ffmpeg.wasm core from `node_modules` into `public/ffmpeg/<version>/`,
splitting the ~32 MB wasm binary into 10 MiB parts (static hosts cap file size; the browser reassembles them on first
use). `npm run build` finishes by checking every output file against Cloudflare Pages' limits.

## Content-Security-Policy

The policy lives in one place, `config/csp.mjs`. `npm run headers` (also run by `prebuild`) expands it into the two
committed files that actually serve it — `nginx.conf` for Docker and `public/_headers` for Cloudflare Pages — from the
templates in `config/`. `vite.config.ts` imports the same constant so `npm run preview` applies it too. CI runs
`npm run headers -- --check` and fails if the generated files are stale, so edit `config/csp.mjs`, never the outputs.

## Deploying to Cloudflare Pages

The repo is ready for Cloudflare Pages' Git integration:

- `wrangler.toml` — Pages project config (`name`, `pages_build_output_dir = "./dist"`). With this file present, those
  fields are read-only in the dashboard.
- `public/_headers` — Content-Security-Policy, security headers and long-lived caching for hashed/versioned assets
  (copied into `dist/` by the build). Generated — see "Content-Security-Policy" below.
- `.nvmrc` — pins Node 22 for the Pages build image.

One-time setup in the Cloudflare dashboard:

1. **Workers & Pages → Create → Pages → Import an existing Git repository**, authorise GitHub and select this repository.
2. **Project name:** `transcription-companion` (must match `name` in `wrangler.toml`; if you choose another name, change
   the file to match).
3. **Production branch:** `main`.
4. **Framework preset:** None. **Build command:** `npm run build`. **Build output directory:** `dist`. **Root directory:** blank.
5. **Save and Deploy.** Every push to `main` deploys to production; pushes to other branches get preview URLs.

To test the production output locally with Cloudflare's own server (applies `_headers` exactly as Pages does):

```bash
npm run build
npx wrangler pages dev dist
```

## Licence

[MIT](LICENSE). Note that the bundled dependencies keep their own licences — in particular the
ffmpeg.wasm core in `public/ffmpeg/` ships under the terms of the `@ffmpeg/core` package
(LGPL/GPL, depending on the build), and `signalsmith-stretch` under its own.

## Docker

```bash
docker build -t transcription-companion .
docker run --rm -p 8080:8080 transcription-companion
```

Then open http://localhost:8080. The image is a multi-stage build: Node compiles the static bundle and an unprivileged
nginx serves it with gzip, long-lived caching for hashed assets, and a strict Content-Security-Policy
(`blob:` is allowed for the AudioWorklet module, `'wasm-unsafe-eval'` for WebAssembly).

## Architecture

```
src/
  audio/
    engine.ts          real-time playback: stretch node time-map, loops/gaps/count-in/trainer, metronome
    chain.ts           channel matrix, karaoke, EQ, pan, volume (shared by playback and export)
    decode.ts          native decodeAudioData with ffmpeg.wasm fallback; analysis mixdown
    analysis.worker.ts pitch roll, chord timeline, key and tempo detection off the main thread
    music.ts           semitone spectrum, note/chord/key/tempo algorithms
    fft.ts, wav.ts, export.ts
  components/          React UI (timeline canvases, transport, panels)
  controller.ts        user actions, file loading, sessions, export
  session.ts           validation for session data from files and localStorage
  prerender.tsx        build-time render of the welcome screen into index.html (for SEO / link previews)
  store.ts             tiny external store used with useSyncExternalStore
  shortcuts.ts         keyboard shortcuts
  *.test.ts            unit tests, run with `npm test` (Vitest)
  audio/fakeAudioContext.ts  test-only stand-in for the Web Audio nodes chain.ts builds
```

The tests cover the parts where a mistake is silent rather than loud: the FFT (against a
naive DFT), note/chord/key/tempo detection on synthesised audio, the analysis worker
end-to-end over a known progression, session validation, the WAV encoder, the processing
chain's routing and filter settings, the remembered-file store, and the view/loop/marker
logic in the controller.

They run in Node, with no browser: `chain.ts` is driven through a fake AudioContext that
records what was built and what was written to each AudioParam, and `recentFile.ts`
through `fake-indexeddb`. `engine.ts` and `export.ts` stay uncovered — the first needs its
scheduling arithmetic separated from AudioContext time before it can be tested sensibly,
the second needs an OfflineAudioContext that can actually run the stretch worklet.

Note on the stretch node: `schedule()` replaces every change timed at or after the node's current time, so the engine
keeps at most one future change pending and queues the second half of stop→resume pairs (loop gaps, count-ins) until the
first has taken effect.
