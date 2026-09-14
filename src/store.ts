import { useSyncExternalStore } from 'react';

export type ChannelMode = 'stereo' | 'mono' | 'left' | 'right' | 'swap' | 'karaoke';

export interface EqBand {
  freq: number;
  gain: number; // dB
  q: number;
}

export interface EqState {
  enabled: boolean;
  hpOn: boolean;
  hpFreq: number;
  lpOn: boolean;
  lpFreq: number;
  bands: EqBand[];
}

/** Preset marker colours, cycled through as markers are added. Chosen to stay distinct from the playhead and loop colours. */
export const MARKER_COLORS = ['#c792ea', '#3ecf8e', '#82aaff', '#ff79c6', '#e6db74', '#5ee7f0'];

export interface Marker {
  id: string;
  time: number;
  label: string;
  /** Index into MARKER_COLORS. */
  color: number;
}

// Sessions saved before markers had colours have no `color` field.
export const markerColor = (m: Marker) => MARKER_COLORS[(m.color ?? 0) % MARKER_COLORS.length];

export interface SavedLoop {
  id: string;
  name: string;
  start: number;
  end: number;
}

export interface ChordSegment {
  start: number;
  end: number;
  root: number;
  suffix: string;
  bass: number | null;
}

export interface PitchRoll {
  hopSec: number;
  noteMin: number; // midi
  noteCount: number;
  frames: number;
  data: Float32Array; // frames * noteCount, normalised 0..1
}

export interface FileInfo {
  name: string;
  size: number;
  duration: number;
  sampleRate: number;
  channels: number;
  decoder: 'native' | 'ffmpeg';
  videoUrl: string | null;
}

export interface AppState {
  file: FileInfo | null;
  loading: { message: string; progress: number | null } | null;
  error: string | null;
  notice: string | null; // brief, non-error message shown in a self-dismissing toast

  playing: boolean;
  playStart: number; // position where playback was last started (for "return")

  rate: number; // 1 = original speed
  semitones: number; // integer transposition
  cents: number; // fine tuning -100..100
  formant: boolean;

  volume: number; // 0..2
  pan: number; // -1..1
  channelMode: ChannelMode;
  karaokeKeepBass: boolean;
  eq: EqState;

  loop: { enabled: boolean; start: number; end: number };
  loopGap: number; // seconds of silence between repetitions
  countIn: { onPlay: boolean; onLoop: boolean; bars: number };
  trainer: {
    enabled: boolean;
    startRate: number;
    targetRate: number;
    step: number;
    repsPerStep: number;
    rep: number; // repetitions completed at current step
  };

  markers: Marker[];
  loops: SavedLoop[];

  tempo: { bpm: number; offset: number; beatsPerBar: number; detectedBpm: number | null };
  gridVisible: boolean;
  snapToGrid: boolean;
  metronome: { on: boolean; volume: number };

  view: { start: number; end: number };
  follow: boolean;
  showRoll: boolean;
  showNotes: boolean; // user preference, shared across all files

  analysis: {
    status: 'idle' | 'running' | 'done' | 'error';
    progress: number;
    key: { tonic: number; mode: 'major' | 'minor' } | null;
    chords: ChordSegment[];
    roll: PitchRoll | null;
  };

  transposeDisplay: number; // semitones added for transposing instruments
  helpOpen: boolean;
}

export const DEFAULT_EQ: EqState = {
  enabled: true,
  hpOn: false,
  hpFreq: 60,
  lpOn: false,
  lpFreq: 12000,
  bands: [
    { freq: 80, gain: 0, q: 0.9 },
    { freq: 250, gain: 0, q: 0.9 },
    { freq: 700, gain: 0, q: 0.9 },
    { freq: 2000, gain: 0, q: 0.9 },
    { freq: 5000, gain: 0, q: 0.9 },
    { freq: 10000, gain: 0, q: 0.9 },
  ],
};

// ------------------------------------------------------------ user preferences
// Settings that apply to every file, persisted in localStorage separately from per-file sessions.

const PREFS_KEY = 'learn-by-ear:prefs';
const PREF_KEYS = ['showNotes'] as const satisfies readonly (keyof AppState)[];
type Prefs = Pick<AppState, (typeof PREF_KEYS)[number]>;

function loadPrefs(): Prefs {
  const prefs: Prefs = { showNotes: true };
  try {
    const data = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    if (typeof data?.showNotes === 'boolean') prefs.showNotes = data.showNotes;
  } catch {}
  return prefs;
}

export const initialState = (): AppState => ({
  file: null,
  loading: null,
  error: null,
  notice: null,
  playing: false,
  playStart: 0,
  rate: 1,
  semitones: 0,
  cents: 0,
  formant: false,
  volume: 1,
  pan: 0,
  channelMode: 'stereo',
  karaokeKeepBass: true,
  eq: structuredClone(DEFAULT_EQ),
  loop: { enabled: false, start: 0, end: 0 },
  loopGap: 0,
  countIn: { onPlay: false, onLoop: false, bars: 1 },
  trainer: { enabled: false, startRate: 0.6, targetRate: 1, step: 0.05, repsPerStep: 2, rep: 0 },
  markers: [],
  loops: [],
  tempo: { bpm: 120, offset: 0, beatsPerBar: 4, detectedBpm: null },
  gridVisible: false,
  snapToGrid: false,
  metronome: { on: false, volume: 0.6 },
  view: { start: 0, end: 1 },
  follow: true,
  showRoll: false,
  ...loadPrefs(),
  analysis: { status: 'idle', progress: 0, key: null, chords: [], roll: null },
  transposeDisplay: 0,
  helpOpen: false,
});

type Listener = (state: AppState, prev: AppState) => void;

class Store {
  private state: AppState = initialState();
  private listeners = new Set<Listener>();

  get = () => this.state;

  set = (patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => {
    const prev = this.state;
    const p = typeof patch === 'function' ? patch(prev) : patch;
    this.state = { ...prev, ...p };
    for (const l of this.listeners) l(this.state, prev);
  };

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

export const store = new Store();

store.subscribe((s, p) => {
  if (!PREF_KEYS.some((k) => s[k] !== p[k])) return;
  const prefs: Record<string, unknown> = {};
  for (const k of PREF_KEYS) prefs[k] = s[k];
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (e) {
    console.warn('Could not save preferences', e);
  }
});

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => selector(store.get()),
  );
}

let idCounter = 0;
export const uid = () => `${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

export const beatDuration = (s: AppState) => 60 / s.tempo.bpm;
