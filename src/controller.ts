import { engine } from './audio/engine';
import { decodeFile, isVideoFile, mixdownForAnalysis } from './audio/decode';
import { ANALYSIS_RATE, NOTE_COUNT, NOTE_MIN } from './audio/music';
import type { AnalysisMessage } from './audio/analysis.worker';
import { renderProcessed } from './audio/export';
import { downloadBlob } from './audio/wav';
import { DEFAULT_EQ, initialState, MARKER_COLORS, store, uid, type AppState, type FileInfo } from './store';
import { forgetRecentFile, saveRecentFile } from './recentFile';
import { sessionPatch, SESSION_KEYS } from './session';
import { clamp } from './util';

// ------------------------------------------------------------ heavy data
// Kept outside the store: large typed arrays that never need to trigger renders.

export interface Peaks {
  bucket: number; // samples per bucket
  min: Float32Array;
  max: Float32Array;
}

let peaks: Peaks | null = null;
let analysisSignal: Float32Array | null = null;
let worker: Worker | null = null;
/** Tempo came from a saved session, so analysis should only report the detected BPM. */
let userTempo = false;

export const getPeaks = () => peaks;
export const getAnalysisSignal = () => analysisSignal;

function computePeaks(buffer: AudioBuffer): Peaks {
  const bucket = 128;
  const n = Math.ceil(buffer.length / bucket);
  const min = new Float32Array(n);
  const max = new Float32Array(n);
  const chans = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => buffer.getChannelData(c));
  const inv = 1 / chans.length;
  for (let b = 0; b < n; b++) {
    let lo = 0;
    let hi = 0;
    const end = Math.min(buffer.length, (b + 1) * bucket);
    for (let i = b * bucket; i < end; i++) {
      let v = 0;
      for (const ch of chans) v += ch[i];
      v *= inv;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { bucket, min, max };
}

// ------------------------------------------------------------ file loading

export async function openFile(file: File) {
  const prev = store.get();
  if (prev.loading) return;
  engine.pause();
  saveLocalSessionNow();
  store.set({ loading: { message: `Opening ${file.name}…`, progress: null }, error: null });
  try {
    const ctx = await engine.init();
    const { buffer, decoder } = await decodeFile(file, ctx, (message, progress) => store.set({ loading: { message, progress } }));
    store.set({ loading: { message: 'Preparing waveform…', progress: null } });
    await new Promise((r) => setTimeout(r, 0));
    peaks = computePeaks(buffer);
    await engine.load(buffer);

    if (prev.file?.videoUrl) URL.revokeObjectURL(prev.file.videoUrl);
    const fresh = initialState();
    const info: FileInfo = {
      name: file.name,
      size: file.size,
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
      decoder,
      videoUrl: isVideoFile(file) ? URL.createObjectURL(file) : null,
    };
    const saved = readLocalSession(info);
    // Only trust a saved tempo once analysis had run for it (otherwise it's just the default).
    userTempo = saved?.patch.tempo?.detectedBpm != null;
    // Keep user preferences (processing & display) across files; reset song-specific data,
    // then resume whatever was autosaved for this file last time.
    store.set({
      file: info,
      loading: null,
      playing: false,
      playStart: saved?.position ?? 0,
      loop: fresh.loop,
      markers: [],
      loops: [],
      trainer: { ...prev.trainer, rep: 0 },
      tempo: fresh.tempo,
      view: saved?.view ?? { start: 0, end: buffer.duration },
      analysis: { ...fresh.analysis, status: 'running' },
      ...saved?.patch,
    });
    engine.seek(saved?.position ?? 0);
    void saveRecentFile(file);
    void startAnalysis(buffer);
  } catch (e) {
    console.error(e);
    store.set({ loading: null, error: e instanceof Error ? e.message : String(e) });
  }
}

async function startAnalysis(buffer: AudioBuffer) {
  worker?.terminate();
  analysisSignal = null;
  try {
    const signal = await mixdownForAnalysis(buffer, ANALYSIS_RATE);
    analysisSignal = signal;
    const w = new Worker(new URL('./audio/analysis.worker.ts', import.meta.url), { type: 'module' });
    worker = w;
    w.onmessage = (e: MessageEvent<AnalysisMessage>) => {
      if (worker !== w) return;
      const msg = e.data;
      if (msg.type === 'progress') {
        store.set((s) => ({ analysis: { ...s.analysis, progress: msg.value } }));
      } else if (msg.type === 'error') {
        store.set((s) => ({ analysis: { ...s.analysis, status: 'error' } }));
      } else {
        store.set((s) => ({
          analysis: {
            status: 'done',
            progress: 1,
            key: msg.key,
            chords: msg.chords,
            roll: { hopSec: msg.hopSec, frames: msg.frames, noteMin: NOTE_MIN, noteCount: NOTE_COUNT, data: msg.roll },
          },
          // Don't clobber a tempo the user restored from a saved session.
          tempo: !msg.tempo
            ? s.tempo
            : userTempo
              ? { ...s.tempo, detectedBpm: msg.tempo.bpm }
              : { ...s.tempo, bpm: msg.tempo.bpm, offset: msg.tempo.offset, detectedBpm: msg.tempo.bpm },
        }));
        w.terminate();
        worker = null;
      }
    };
    const copy = signal.slice();
    w.postMessage({ signal: copy }, [copy.buffer]);
  } catch (e) {
    console.error('analysis failed', e);
    store.set((s) => ({ analysis: { ...s.analysis, status: 'error' } }));
  }
}

// ------------------------------------------------------------ engine sync

export function initController() {
  const flush = () => saveLocalSessionNow();
  const onVisibility = () => document.visibilityState === 'hidden' && flush();
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', onVisibility);
  const unsubscribe = store.subscribe((s, p) => {
    if (s.file && s.file === p.file && (s.playing !== p.playing || s.playStart !== p.playStart || s.view !== p.view || SESSION_KEYS.some((k) => s[k] !== p[k]))) {
      scheduleLocalSave();
    }
    if (s.rate !== p.rate || s.semitones !== p.semitones || s.cents !== p.cents || s.formant !== p.formant) {
      engine.updateParams();
    }
    if (s.eq !== p.eq || s.channelMode !== p.channelMode || s.karaokeKeepBass !== p.karaokeKeepBass || s.pan !== p.pan || s.volume !== p.volume) {
      engine.chain?.apply(s);
    }
    if (s.loop !== p.loop || s.loopGap !== p.loopGap || s.countIn.onLoop !== p.countIn.onLoop) {
      engine.loopChanged();
    }
  });
  return () => {
    unsubscribe();
    window.removeEventListener('pagehide', flush);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

// ------------------------------------------------------------ helpers

const duration = () => store.get().file?.duration ?? 0;
const pos = () => engine.getPosition();

export function snap(t: number, s: AppState = store.get()): number {
  if (!s.snapToGrid) return t;
  const beat = 60 / s.tempo.bpm;
  return s.tempo.offset + Math.round((t - s.tempo.offset) / beat) * beat;
}

// ------------------------------------------------------------ transport

export const togglePlay = () => engine.toggle();

export function seek(t: number) {
  engine.seek(clamp(t, 0, duration()));
  if (!store.get().playing) store.set({ playStart: clamp(t, 0, duration()) });
}

export const seekRelative = (delta: number) => seek(pos() + delta);

export function returnToPlayStart() {
  const s = store.get();
  engine.seek(s.playStart);
}

export function seekBars(n: number) {
  const s = store.get();
  seek(pos() + (n * s.tempo.beatsPerBar * 60) / s.tempo.bpm);
}

// ------------------------------------------------------------ speed / pitch

export const setRate = (rate: number) => store.set({ rate: Math.round(clamp(rate, 0.05, 4) * 1000) / 1000 });
export const nudgeRate = (delta: number) => setRate(store.get().rate + delta);
export const setSemitones = (semitones: number) => store.set({ semitones: clamp(Math.round(semitones), -24, 24) });
export const setCents = (cents: number) => store.set({ cents: clamp(Math.round(cents), -100, 100) });

export function nudgeCents(delta: number) {
  const s = store.get();
  let total = s.semitones * 100 + s.cents + delta;
  total = clamp(total, -2400, 2400);
  const semis = Math.round(total / 100);
  store.set({ semitones: semis, cents: total - semis * 100 });
}

export const resetSpeedPitch = () => store.set({ rate: 1, semitones: 0, cents: 0 });

// ------------------------------------------------------------ loops

export function setLoop(start: number, end: number, enabled = true) {
  const d = duration();
  const a = clamp(Math.min(start, end), 0, d);
  let b = clamp(Math.max(start, end), 0, d);
  if (b - a < 0.02) b = Math.min(d, a + 0.02);
  store.set((s) => ({ loop: { enabled, start: a, end: b }, trainer: { ...s.trainer, rep: 0 } }));
}

export function setLoopStartHere() {
  const s = store.get();
  const t = snap(pos());
  const end = s.loop.end > t + 0.02 ? s.loop.end : Math.min(duration(), t + 4);
  setLoop(t, end, s.loop.enabled || s.loop.end > t);
}

export function setLoopEndHere() {
  const s = store.get();
  const t = snap(pos());
  const start = s.loop.start < t - 0.02 ? s.loop.start : Math.max(0, t - 4);
  setLoop(start, t, true);
}

export function toggleLoop() {
  const s = store.get();
  if (s.loop.end - s.loop.start < 0.02) {
    // no region yet: loop the current bar-ish window around the playhead
    const p = pos();
    setLoop(p, p + (s.tempo.beatsPerBar * 60) / s.tempo.bpm, true);
    return;
  }
  store.set((st) => ({ loop: { ...st.loop, enabled: !st.loop.enabled }, trainer: { ...st.trainer, rep: 0 } }));
}

export function nudgeLoop(edge: 'start' | 'end', delta: number) {
  const { loop } = store.get();
  if (edge === 'start') setLoop(Math.min(loop.start + delta, loop.end - 0.02), loop.end, loop.enabled);
  else setLoop(loop.start, Math.max(loop.end + delta, loop.start + 0.02), loop.enabled);
}

/** Double / halve the loop length (keeping the start). */
export function scaleLoop(factor: number) {
  const { loop } = store.get();
  setLoop(loop.start, loop.start + (loop.end - loop.start) * factor, loop.enabled);
}

/** Move the loop forward/back by its own length (practise the next phrase). */
export function shiftLoop(direction: 1 | -1) {
  const { loop } = store.get();
  const len = loop.end - loop.start;
  const start = clamp(loop.start + direction * len, 0, Math.max(0, duration() - len));
  setLoop(start, start + len, loop.enabled);
  engine.seek(start);
}

export function saveCurrentLoop() {
  const s = store.get();
  if (s.loop.end - s.loop.start < 0.02) return;
  const name = `Loop ${s.loops.length + 1}`;
  store.set({ loops: [...s.loops, { id: uid(), name, start: s.loop.start, end: s.loop.end }] });
}

export function recallLoop(id: string) {
  const l = store.get().loops.find((x) => x.id === id);
  if (!l) return;
  setLoop(l.start, l.end, true);
  engine.seek(l.start);
  zoomToRange(l.start, l.end);
}

export const renameLoop = (id: string, name: string) => store.set((s) => ({ loops: s.loops.map((l) => (l.id === id ? { ...l, name } : l)) }));
export const deleteLoop = (id: string) => store.set((s) => ({ loops: s.loops.filter((l) => l.id !== id) }));

// ------------------------------------------------------------ markers

export function addMarker(at = pos()) {
  const s = store.get();
  const t = snap(at);
  // Give each new marker the least-used colour, so colours rotate through the palette.
  const uses = MARKER_COLORS.map((_, i) => s.markers.filter((m) => (m.color ?? 0) === i).length);
  const color = uses.indexOf(Math.min(...uses));
  // Markers are identified by their index (shown on the flag), so they start unlabelled.
  const markers = [...s.markers, { id: uid(), time: t, label: '', color }].sort((a, b) => a.time - b.time);
  store.set({ markers });
}

export const cycleMarkerColor = (id: string) =>
  store.set((s) => ({
    markers: s.markers.map((m) => (m.id === id ? { ...m, color: ((m.color ?? 0) + 1) % MARKER_COLORS.length } : m)),
  }));

export const renameMarker = (id: string, label: string) => store.set((s) => ({ markers: s.markers.map((m) => (m.id === id ? { ...m, label } : m)) }));
export const deleteMarker = (id: string) => store.set((s) => ({ markers: s.markers.filter((m) => m.id !== id) }));
export const moveMarker = (id: string, time: number) =>
  store.set((s) => ({
    markers: s.markers.map((m) => (m.id === id ? { ...m, time: clamp(time, 0, duration()) } : m)).sort((a, b) => a.time - b.time),
  }));

export function jumpToMarker(index: number) {
  const m = store.get().markers[index];
  if (m) seek(m.time);
}

export function jumpAdjacentMarker(direction: 1 | -1) {
  const p = pos();
  const ms = store.get().markers;
  const target = direction > 0 ? ms.find((m) => m.time > p + 0.05) : [...ms].reverse().find((m) => m.time < p - 0.3);
  seek(target ? target.time : direction > 0 ? duration() : 0);
}

/** Loop from a marker to the next marker (or end of file). */
export function loopFromMarker(id: string) {
  const ms = store.get().markers;
  const i = ms.findIndex((m) => m.id === id);
  if (i < 0) return;
  const end = ms[i + 1]?.time ?? duration();
  setLoop(ms[i].time, end, true);
  engine.seek(ms[i].time);
}

// ------------------------------------------------------------ tempo

let taps: number[] = [];

export function tapTempo() {
  const now = performance.now() / 1000;
  const s = store.get();
  engine.tapClick();
  if (taps.length && now - taps[taps.length - 1] > 2) taps = [];
  taps.push(now);
  if (taps.length > 8) taps.shift();
  if (taps.length >= 3) {
    const intervals = taps.slice(1).map((t, i) => t - taps[i]);
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    // taps happen in real time; convert to song tempo at the current speed
    const factor = s.playing ? s.rate : 1;
    const bpm = Math.round((60 / (avg * factor)) * 10) / 10;
    const offset = s.playing ? pos() % (60 / bpm) : s.tempo.offset;
    store.set({ tempo: { ...s.tempo, bpm: clamp(bpm, 20, 400), offset } });
  }
}

export function setDownbeatHere() {
  const s = store.get();
  const beat = 60 / s.tempo.bpm;
  const p = pos();
  store.set({ tempo: { ...s.tempo, offset: ((p % beat) + beat) % beat }, gridVisible: true });
}

export const setBpm = (bpm: number) => store.set((s) => ({ tempo: { ...s.tempo, bpm: clamp(Math.round(bpm * 100) / 100, 20, 400) } }));

// ------------------------------------------------------------ view

export function setView(start: number, end: number) {
  const d = duration();
  if (d <= 0) return;
  const w = clamp(end - start, Math.min(0.05, d), d);
  const a = clamp(start, 0, d - w);
  store.set({ view: { start: a, end: a + w } });
}

export function zoom(factor: number, centre?: number) {
  const { view } = store.get();
  const c = centre ?? clamp(pos(), view.start, view.end);
  const w = (view.end - view.start) * factor;
  const rel = (c - view.start) / (view.end - view.start || 1);
  setView(c - w * rel, c - w * rel + w);
}

export const zoomToRange = (a: number, b: number) => {
  const pad = (b - a) * 0.05;
  setView(a - pad, b + pad);
};

export const zoomAll = () => setView(0, duration());

export function zoomToLoopOrAll() {
  const { loop, view } = store.get();
  if (loop.end - loop.start > 0.02 && !(Math.abs(view.start - (loop.start - (loop.end - loop.start) * 0.05)) < 0.01)) {
    zoomToRange(loop.start, loop.end);
  } else zoomAll();
}

/** Keep the playhead visible while playing, page-turn style. */
export function followPlayhead(p: number) {
  const { view, follow, playing } = store.get();
  if (!follow || !playing) return;
  const w = view.end - view.start;
  if (p > view.end - w * 0.02 || p < view.start) setView(p - w * 0.05, p - w * 0.05 + w);
}

// ------------------------------------------------------------ EQ presets

export const EQ_PRESETS: Record<string, (eq: AppState['eq']) => AppState['eq']> = {
  Flat: () => structuredClone(DEFAULT_EQ),
  'Bass focus': () => ({
    ...structuredClone(DEFAULT_EQ),
    lpOn: true,
    lpFreq: 900,
    bands: DEFAULT_EQ.bands.map((b, i) => ({ ...b, gain: [6, 3, 0, 0, 0, 0][i] })),
  }),
  'Guitar / keys focus': () => ({
    ...structuredClone(DEFAULT_EQ),
    hpOn: true,
    hpFreq: 180,
    lpOn: true,
    lpFreq: 6000,
    bands: DEFAULT_EQ.bands.map((b, i) => ({ ...b, gain: [0, 2, 4, 3, 0, 0][i] })),
  }),
  'Vocal focus': () => ({
    ...structuredClone(DEFAULT_EQ),
    hpOn: true,
    hpFreq: 150,
    lpOn: true,
    lpFreq: 8000,
    bands: DEFAULT_EQ.bands.map((b, i) => ({ ...b, gain: [0, -2, 2, 5, 2, 0][i] })),
  }),
  'Cut bass': () => ({ ...structuredClone(DEFAULT_EQ), hpOn: true, hpFreq: 200 }),
  'Drums / hi-hat': () => ({
    ...structuredClone(DEFAULT_EQ),
    hpOn: true,
    hpFreq: 2500,
    bands: DEFAULT_EQ.bands.map((b, i) => ({ ...b, gain: [0, 0, 0, 0, 4, 6][i] })),
  }),
};

// ------------------------------------------------------------ export & sessions

export async function exportAudio(region: 'loop' | 'all') {
  const s = store.get();
  const buffer = engine.buffer;
  if (!buffer || !s.file) return;
  const [start, end] = region === 'loop' && s.loop.end - s.loop.start > 0.02 ? [s.loop.start, s.loop.end] : [0, buffer.duration];
  store.set({ loading: { message: 'Rendering processed audio…', progress: null } });
  try {
    await new Promise((r) => setTimeout(r, 30));
    const blob = await renderProcessed(buffer, s, start, end);
    const base = s.file.name.replace(/\.[^.]+$/, '');
    const tag = [
      region === 'loop' ? 'loop' : '',
      s.rate !== 1 ? `${Math.round(s.rate * 100)}pct` : '',
      s.semitones || s.cents ? `${s.semitones >= 0 ? '+' : ''}${s.semitones}st${s.cents ? `${s.cents}c` : ''}` : '',
    ]
      .filter(Boolean)
      .join('_');
    downloadBlob(blob, `${base}${tag ? `_${tag}` : ''}.wav`);
    store.set({ loading: null });
  } catch (e) {
    console.error(e);
    store.set({ loading: null, error: `Export failed: ${e instanceof Error ? e.message : e}` });
  }
}

export function saveSession() {
  const s = store.get();
  if (!s.file) return;
  const data: Record<string, unknown> = { app: 'transcription-companion', version: 1, fileName: s.file.name, duration: s.file.duration };
  for (const k of SESSION_KEYS) data[k] = s[k];
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `${s.file.name.replace(/\.[^.]+$/, '')}.tcsession.json`);
}

export async function loadSession(file: File) {
  try {
    const data = JSON.parse(await file.text());
    if (data?.app !== 'transcription-companion') throw new Error('Not a Learn By Ear session file.');
    const patch = sessionPatch(data);
    if (Object.keys(patch).length === 0) throw new Error('It contains no settings this version understands.');
    if (patch.tempo) userTempo = true;
    store.set(patch);
    const s = store.get();
    if (s.file && data.fileName && data.fileName !== s.file.name) {
      store.set({ error: `Session was saved for "${data.fileName}" — applied to "${s.file.name}" anyway.` });
    }
  } catch (e) {
    store.set({ error: `Could not load session: ${e instanceof Error ? e.message : e}` });
  }
}

// ------------------------------------------------------------ local autosave
// Every file gets its own session in localStorage, resumed next time the same file is opened.

const LOCAL_PREFIX = 'learn-by-ear:session:';
const LOCAL_MAX_SESSIONS = 100;
const LOCAL_SAVE_DELAY = 400;

// Name alone collides too easily (e.g. "Track 01.mp3"), so include size and decoded duration.
const localKey = (f: FileInfo) => `${LOCAL_PREFIX}${JSON.stringify([f.name, f.size, Math.round(f.duration * 1000)])}`;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** Set once the session has been discarded for recovery, so nothing writes it back. */
let autosaveDisabled = false;

function readLocalSession(f: FileInfo): { patch: Partial<AppState>; position: number; view: AppState['view'] | null } | null {
  try {
    const raw = localStorage.getItem(localKey(f));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.app !== 'transcription-companion') return null;
    const patch = sessionPatch(data);
    const position = Number.isFinite(data.position) ? clamp(data.position, 0, f.duration) : 0;
    const v = data.view;
    const view = Number.isFinite(v?.start) && Number.isFinite(v?.end) && v.start >= 0 && v.end <= f.duration && v.end > v.start ? { start: v.start, end: v.end } : null;
    return { patch, position, view };
  } catch {
    return null;
  }
}

function scheduleLocalSave() {
  if (autosaveDisabled) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLocalSessionNow, LOCAL_SAVE_DELAY);
}

function saveLocalSessionNow() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const s = store.get();
  if (!s.file || autosaveDisabled) return;
  const data: Record<string, unknown> = {
    app: 'transcription-companion',
    version: 1,
    fileName: s.file.name,
    duration: s.file.duration,
    savedAt: Date.now(),
    position: engine.getPosition(),
    view: s.view,
  };
  for (const k of SESSION_KEYS) data[k] = s[k];
  const key = localKey(s.file);
  const json = JSON.stringify(data);
  try {
    const isNew = localStorage.getItem(key) === null;
    try {
      localStorage.setItem(key, json);
    } catch {
      // Probably over quota: make room by dropping the oldest sessions, then retry once.
      pruneLocalSessions(key, Math.floor(LOCAL_MAX_SESSIONS / 2));
      localStorage.setItem(key, json);
    }
    if (isNew) pruneLocalSessions(key, LOCAL_MAX_SESSIONS);
  } catch (e) {
    console.warn('Could not autosave session', e);
  }
}

/** Keep at most `max` sessions (always including `keep`), dropping the least recently saved. */
function pruneLocalSessions(keep: string, max: number) {
  const entries: { key: string; savedAt: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(LOCAL_PREFIX) || key === keep) continue;
    let savedAt = 0;
    try {
      savedAt = JSON.parse(localStorage.getItem(key) ?? '{}').savedAt ?? 0;
    } catch {}
    entries.push({ key, savedAt });
  }
  entries.sort((a, b) => b.savedAt - a.savedAt);
  for (const { key } of entries.slice(Math.max(0, max - 1))) localStorage.removeItem(key);
}

/**
 * Recovery path for the error boundary: throw away everything that would be restored on
 * the next visit, so a state that crashes the app can't come straight back. Autosaving is
 * switched off for the rest of the page's life — the crashed UI must not write it again
 * (`initController` also flushes on pagehide, i.e. during the reload that follows).
 */
export async function clearRestoreState() {
  autosaveDisabled = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const file = store.get().file;
  if (file) {
    try {
      localStorage.removeItem(localKey(file));
    } catch (e) {
      console.warn('Could not clear the saved session', e);
    }
  }
  await forgetRecentFile();
}
