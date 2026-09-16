// Validation for session data coming from outside the app: a `.tcsession.json` file the
// user picked, or a localStorage entry written by an older (or newer) version. Anything
// here is untrusted — a bad value reaches the audio chain and the canvases directly, so
// every field is checked and out-of-range or wrong-typed ones fall back to the default.

import { DEFAULT_EQ, initialState, MARKER_COLORS, uid, type AppState, type EqBand, type EqState, type Marker, type SavedLoop } from './store';

export const SESSION_KEYS = [
  'rate', 'semitones', 'cents', 'formant', 'volume', 'pan', 'channelMode', 'karaokeKeepBass', 'eq',
  'loop', 'loopGap', 'countIn', 'trainer', 'markers', 'loops', 'tempo', 'gridVisible', 'snapToGrid',
  'metronome', 'transposeDisplay',
] as const satisfies readonly (keyof AppState)[];

type SessionKey = (typeof SESSION_KEYS)[number];

/** Longest time value accepted, in seconds — far past any real recording. */
const MAX_TIME = 24 * 60 * 60;
const MAX_MARKERS = 1000;
const MAX_LOOPS = 500;
const MAX_LABEL = 200;

// ------------------------------------------------------------ primitives
// Each returns `undefined` when the value is unusable, so callers can `?? fallback`.

const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);

const num = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined;

const int = (v: unknown, min: number, max: number) => {
  const n = num(v, min, max);
  return n === undefined ? undefined : Math.round(n);
};

const time = (v: unknown) => num(v, 0, MAX_TIME);

const str = (v: unknown, maxLen: number) => (typeof v === 'string' ? v.slice(0, maxLen) : undefined);

const oneOf = <T extends string>(v: unknown, options: readonly T[]) => (options.includes(v as T) ? (v as T) : undefined);

/** A plain object — unlike `typeof v === 'object'`, rejects null and arrays. */
const rec = (v: unknown) =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

/** Up to `max` items, dropping any the item parser rejects. */
function arr<T>(v: unknown, max: number, item: (x: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: T[] = [];
  for (const x of v.slice(0, max)) {
    const parsed = item(x);
    if (parsed !== undefined) out.push(parsed);
  }
  return out;
}

// ------------------------------------------------------------ compound values

const marker = (v: unknown): Marker | undefined => {
  const m = rec(v);
  const t = time(m?.time);
  if (!m || t === undefined) return undefined;
  return {
    id: str(m.id, 64) || uid(),
    time: t,
    label: str(m.label, MAX_LABEL) ?? '',
    color: int(m.color, 0, MARKER_COLORS.length - 1) ?? 0,
  };
};

const savedLoop = (v: unknown): SavedLoop | undefined => {
  const l = rec(v);
  const start = time(l?.start);
  const end = time(l?.end);
  if (!l || start === undefined || end === undefined || end <= start) return undefined;
  return { id: str(l.id, 64) || uid(), name: str(l.name, MAX_LABEL) ?? 'Loop', start, end };
};

const eqBand = (v: unknown, d: EqBand): EqBand => {
  const b = rec(v);
  return {
    freq: num(b?.freq, 20, 20000) ?? d.freq,
    gain: num(b?.gain, -24, 24) ?? d.gain,
    q: num(b?.q, 0.2, 12) ?? d.q,
  };
};

// The chain wires up exactly DEFAULT_EQ.bands.length peaking filters and indexes them by
// position, so the band count has to match rather than merely be "close enough".
const eq = (v: unknown): EqState | undefined => {
  const e = rec(v);
  if (!e) return undefined;
  const bands = Array.isArray(e.bands) ? e.bands : [];
  return {
    enabled: bool(e.enabled) ?? DEFAULT_EQ.enabled,
    hpOn: bool(e.hpOn) ?? DEFAULT_EQ.hpOn,
    hpFreq: num(e.hpFreq, 20, 5000) ?? DEFAULT_EQ.hpFreq,
    lpOn: bool(e.lpOn) ?? DEFAULT_EQ.lpOn,
    lpFreq: num(e.lpFreq, 200, 20000) ?? DEFAULT_EQ.lpFreq,
    bands: DEFAULT_EQ.bands.map((d, i) => eqBand(bands[i], d)),
  };
};

// ------------------------------------------------------------ per-key parsers

type Parsers = { [K in SessionKey]: (v: unknown, d: AppState) => AppState[K] | undefined };

const parsers: Parsers = {
  rate: (v) => num(v, 0.05, 4),
  semitones: (v) => int(v, -24, 24),
  cents: (v) => int(v, -100, 100),
  formant: bool,
  volume: (v) => num(v, 0, 2),
  pan: (v) => num(v, -1, 1),
  channelMode: (v) => oneOf(v, ['stereo', 'mono', 'left', 'right', 'swap', 'karaoke'] as const),
  karaokeKeepBass: bool,
  eq,
  loop: (v, d) => {
    const l = rec(v);
    const start = time(l?.start);
    const end = time(l?.end);
    if (!l || start === undefined || end === undefined || end < start) return undefined;
    return { enabled: bool(l.enabled) ?? d.loop.enabled, start, end };
  },
  loopGap: (v) => num(v, 0, 60),
  countIn: (v, d) => {
    const ci = rec(v);
    if (!ci) return undefined;
    return {
      onPlay: bool(ci.onPlay) ?? d.countIn.onPlay,
      onLoop: bool(ci.onLoop) ?? d.countIn.onLoop,
      bars: int(ci.bars, 1, 8) ?? d.countIn.bars,
    };
  },
  trainer: (v, d) => {
    const t = rec(v);
    if (!t) return undefined;
    return {
      enabled: bool(t.enabled) ?? d.trainer.enabled,
      startRate: num(t.startRate, 0.05, 4) ?? d.trainer.startRate,
      targetRate: num(t.targetRate, 0.05, 4) ?? d.trainer.targetRate,
      step: num(t.step, 0.01, 0.5) ?? d.trainer.step,
      repsPerStep: int(t.repsPerStep, 1, 50) ?? d.trainer.repsPerStep,
      // Progress through the trainer is never restored — practice restarts at the first step.
      rep: 0,
    };
  },
  markers: (v) => arr(v, MAX_MARKERS, marker)?.sort((a, b) => a.time - b.time),
  loops: (v) => arr(v, MAX_LOOPS, savedLoop),
  tempo: (v, d) => {
    const t = rec(v);
    if (!t) return undefined;
    const bpm = num(t.bpm, 20, 400) ?? d.tempo.bpm;
    return {
      bpm,
      // The grid offset is a position within one beat.
      offset: num(t.offset, 0, 60 / bpm) ?? d.tempo.offset,
      beatsPerBar: int(t.beatsPerBar, 2, 7) ?? d.tempo.beatsPerBar,
      detectedBpm: num(t.detectedBpm, 20, 400) ?? null,
    };
  },
  gridVisible: bool,
  snapToGrid: bool,
  metronome: (v, d) => {
    const m = rec(v);
    if (!m) return undefined;
    return { on: bool(m.on) ?? d.metronome.on, volume: num(m.volume, 0, 1) ?? d.metronome.volume };
  },
  transposeDisplay: (v) => int(v, -24, 24),
};

/**
 * Turn raw parsed JSON into a state patch, keeping only the fields that are present and
 * valid. Never throws: anything unrecognised is simply left out, so the app falls back to
 * its current value for that setting.
 */
export function sessionPatch(data: Record<string, unknown>): Partial<AppState> {
  const patch: Partial<AppState> = {};
  const defaults = initialState();
  for (const k of SESSION_KEYS) {
    if (!(k in data)) continue;
    const value = parsers[k](data[k], defaults);
    if (value !== undefined) (patch as Record<string, unknown>)[k] = value;
  }
  return patch;
}
