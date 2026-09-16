import { magnitudeSpectrum } from './fft';

export const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

/** Lowest/highest MIDI notes analysed: C1 (32.7 Hz) .. C8 (4186 Hz). */
export const NOTE_MIN = 24;
export const NOTE_MAX = 108;
export const NOTE_COUNT = NOTE_MAX - NOTE_MIN + 1;

export const midiToFreq = (m: number) => 440 * 2 ** ((m - 69) / 12);
export const pcName = (pc: number) => NOTE_NAMES[((pc % 12) + 12) % 12];
export const noteName = (midi: number) => `${pcName(midi)}${Math.floor(midi / 12) - 1}`;

/** Analysis sample rate. Mono audio is resampled to this before analysis. */
export const ANALYSIS_RATE = 22050;
export const FRAME_SIZE = 8192;

/**
 * Collapse a linear magnitude spectrum into one value per semitone
 * (peak magnitude within ±half a semitone, interpolated for low notes where
 * bins are wider than a semitone).
 */
export function semitoneSpectrum(mags: Float32Array, sampleRate: number, fftSize: number, out?: Float32Array): Float32Array {
  const res = out ?? new Float32Array(NOTE_COUNT);
  const binHz = sampleRate / fftSize;
  for (let i = 0; i < NOTE_COUNT; i++) {
    const m = NOTE_MIN + i;
    const lo = midiToFreq(m - 0.5) / binHz;
    const hi = midiToFreq(m + 0.5) / binHz;
    const centre = midiToFreq(m) / binHz;
    const c0 = Math.floor(centre);
    const frac = centre - c0;
    let peak = mags[c0] * (1 - frac) + (mags[c0 + 1] ?? 0) * frac;
    for (let b = Math.ceil(lo); b <= Math.floor(hi) && b < mags.length; b++) {
      if (mags[b] > peak) peak = mags[b];
    }
    res[i] = peak;
  }
  return res;
}

/** Semitone spectrum of the analysis signal centred at `timeSec`. */
export function spectrumAt(signal: Float32Array, timeSec: number): Float32Array {
  const centre = Math.round(timeSec * ANALYSIS_RATE);
  const mags = magnitudeSpectrum(signal, centre - FRAME_SIZE / 2, FRAME_SIZE);
  return semitoneSpectrum(mags, ANALYSIS_RATE, FRAME_SIZE);
}

/** Convert magnitudes to a 0..1 display scale using a 60 dB range below `ref`. */
export function toDisplayLevels(spec: Float32Array, ref: number, rangeDb = 60): Float32Array {
  const out = new Float32Array(spec.length);
  const r = Math.max(ref, 1e-9);
  for (let i = 0; i < spec.length; i++) {
    const db = 20 * Math.log10(Math.max(spec[i], 1e-9) / r);
    out[i] = Math.min(1, Math.max(0, 1 + db / rangeDb));
  }
  return out;
}

const HARMONICS = [12, 19, 24, 28, 31, 34, 36];
const HARMONIC_WEIGHT = [0.5, 0.35, 0.25, 0.2, 0.15, 0.12, 0.1];

/**
 * Guess which notes are sounding. Greedy peak picking with harmonic
 * suppression: take the strongest note, remove the expected energy of its
 * overtones, repeat. Returns MIDI note numbers, lowest first.
 */
export function guessNotes(spec: Float32Array, maxNotes = 6, thresholdDb = -18): number[] {
  const s = Float32Array.from(spec);
  let max = 0;
  for (const v of s) if (v > max) max = v;
  if (max < 1e-4) return [];
  const threshold = max * 10 ** (thresholdDb / 20);
  const notes: number[] = [];
  for (let iter = 0; iter < maxNotes; iter++) {
    let best = -1;
    let bestVal = threshold;
    for (let i = 0; i < s.length; i++) {
      // must be a local peak to count as a note
      if (s[i] > bestVal && s[i] >= (s[i - 1] ?? 0) && s[i] >= (s[i + 1] ?? 0)) {
        best = i;
        bestVal = s[i];
      }
    }
    if (best < 0) break;
    notes.push(NOTE_MIN + best);
    s[best] = 0;
    for (let h = 0; h < HARMONICS.length; h++) {
      const j = best + HARMONICS[h];
      if (j < s.length) s[j] = Math.max(0, s[j] - bestVal * HARMONIC_WEIGHT[h] * 2);
    }
    // neighbours are usually leakage from the same partial
    if (best > 0) s[best - 1] *= 0.3;
    if (best + 1 < s.length) s[best + 1] *= 0.3;
  }
  return notes.sort((a, b) => a - b);
}

/** 12-bin pitch-class profile, de-emphasising very high partials. */
export function chroma(spec: Float32Array): Float32Array {
  const c = new Float32Array(12);
  for (let i = 0; i < spec.length; i++) {
    const m = NOTE_MIN + i;
    const w = m > 84 ? 0.4 : 1;
    c[m % 12] += spec[i] * spec[i] * w;
  }
  for (let i = 0; i < 12; i++) c[i] = Math.sqrt(c[i]);
  return c;
}

interface ChordType {
  suffix: string;
  intervals: number[];
  bias: number;
}

const CHORD_TYPES: ChordType[] = [
  { suffix: '', intervals: [0, 4, 7], bias: 1 },
  { suffix: 'm', intervals: [0, 3, 7], bias: 1 },
  { suffix: '7', intervals: [0, 4, 7, 10], bias: 0.97 },
  { suffix: 'maj7', intervals: [0, 4, 7, 11], bias: 0.96 },
  { suffix: 'm7', intervals: [0, 3, 7, 10], bias: 0.97 },
  { suffix: '6', intervals: [0, 4, 7, 9], bias: 0.93 },
  { suffix: 'm6', intervals: [0, 3, 7, 9], bias: 0.92 },
  { suffix: 'sus4', intervals: [0, 5, 7], bias: 0.94 },
  { suffix: 'sus2', intervals: [0, 2, 7], bias: 0.93 },
  { suffix: 'dim', intervals: [0, 3, 6], bias: 0.92 },
  { suffix: 'aug', intervals: [0, 4, 8], bias: 0.9 },
  { suffix: 'm7♭5', intervals: [0, 3, 6, 10], bias: 0.92 },
  { suffix: 'dim7', intervals: [0, 3, 6, 9], bias: 0.9 },
  { suffix: '7♯9', intervals: [0, 4, 7, 10, 3], bias: 0.86 },
  { suffix: '9', intervals: [0, 4, 7, 10, 2], bias: 0.88 },
  { suffix: '5', intervals: [0, 7], bias: 0.85 },
];

export interface ChordGuess {
  root: number;
  suffix: string;
  bass: number | null; // pitch class when different from root (slash chord)
  score: number;
}

export function formatChord(c: { root: number; suffix: string; bass: number | null }, transpose = 0): string {
  return pcName(c.root + transpose) + c.suffix + (c.bass !== null ? `/${pcName(c.bass + transpose)}` : '');
}

/**
 * Template-matching chord recogniser. `bassPc` (optional) is the pitch class
 * of the lowest strong note; if it isn't the root (but is a chord tone) the
 * chord is reported as a slash chord.
 */
export function guessChord(ch: Float32Array, bassPc?: number): ChordGuess | null {
  let norm = 0;
  let total = 0;
  for (const v of ch) {
    norm += v * v;
    total += v;
  }
  norm = Math.sqrt(norm);
  if (norm < 1e-4 || total < 1e-3) return null;
  let best: ChordGuess | null = null;
  for (let root = 0; root < 12; root++) {
    for (const type of CHORD_TYPES) {
      let dot = 0;
      for (const iv of type.intervals) dot += ch[(root + iv) % 12] * (iv === 0 ? 1.1 : 1);
      let score = (dot / (norm * Math.sqrt(type.intervals.length))) * type.bias;
      if (bassPc !== undefined && bassPc === root) score *= 1.06;
      if (!best || score > best.score) {
        const slash = bassPc !== undefined && bassPc !== root && type.intervals.includes((bassPc - root + 12) % 12);
        best = { root, suffix: type.suffix, bass: slash ? bassPc! : null, score };
      }
    }
  }
  return best && best.score > 0.55 ? best : null;
}

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlation(a: ArrayLike<number>, b: ArrayLike<number>, shift: number): number {
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < 12; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= 12;
  mb /= 12;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < 12; i++) {
    const x = a[(i + shift) % 12] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return num / Math.sqrt(da * db || 1);
}

/** Krumhansl–Schmuckler key estimate from an accumulated chroma vector. */
export function detectKey(ch: ArrayLike<number>): { tonic: number; mode: 'major' | 'minor'; confidence: number } {
  let best = { tonic: 0, mode: 'major' as 'major' | 'minor', confidence: -Infinity };
  for (let t = 0; t < 12; t++) {
    const maj = correlation(ch, MAJOR_PROFILE, t);
    const min = correlation(ch, MINOR_PROFILE, t);
    if (maj > best.confidence) best = { tonic: t, mode: 'major', confidence: maj };
    if (min > best.confidence) best = { tonic: t, mode: 'minor', confidence: min };
  }
  return best;
}

/**
 * Tempo from an onset-strength envelope via autocorrelation weighted towards
 * ~120 BPM, then beat phase by comb-filter alignment.
 */
export function detectTempo(env: Float32Array, hopSec: number): { bpm: number; offset: number } | null {
  const n = env.length;
  if (n * hopSec < 4) return null;
  const minLag = Math.floor(60 / 200 / hopSec);
  const maxLag = Math.min(Math.ceil(60 / 50 / hopSec), n - 1);
  const ac = new Float32Array(maxLag + 2);
  let mean = 0;
  for (const v of env) mean += v;
  mean /= n;
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < n; i++) sum += (env[i] - mean) * (env[i + lag] - mean);
    ac[lag] = sum / (n - lag);
  }
  let bestLag = -1;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 / (lag * hopSec);
    const w = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    // reward lags whose double also correlates (metrical consistency)
    const dbl = lag * 2 <= maxLag + 1 ? ac[lag * 2] : 0;
    const score = (ac[lag] + 0.5 * Math.max(0, dbl)) * w;
    if (ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1] && score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag < 0) return null;
  const y0 = ac[bestLag - 1];
  const y1 = ac[bestLag];
  const y2 = ac[bestLag + 1];
  const denom = y0 - 2 * y1 + y2;
  const coarse = bestLag + (denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0);

  // Fine search: comb-filter alignment over the whole envelope resolves the
  // period far more precisely than a single autocorrelation lag.
  const sample = (t: number) => {
    const i = Math.floor(t);
    const f = t - i;
    return i + 1 < n ? env[i] * (1 - f) + env[i + 1] * f : 0;
  };
  const combScore = (period: number) => {
    const steps = Math.max(4, Math.round(period));
    let best = -Infinity;
    let bestPhase = 0;
    for (let s = 0; s < steps; s++) {
      const p = (s / steps) * period;
      let sum = 0;
      let count = 0;
      for (let t = p; t < n - 1; t += period, count++) sum += Math.max(sample(t - 0.5), sample(t), sample(t + 0.5));
      const score = sum / Math.max(1, count);
      if (score > best) [best, bestPhase] = [score, p];
    }
    return { score: best, phase: bestPhase };
  };
  let bestPeriod = coarse;
  let best = combScore(coarse);
  for (let d = -0.03; d <= 0.03; d += 0.0015) {
    const period = coarse * (1 + d);
    const r = combScore(period);
    if (r.score > best.score) [bestPeriod, best] = [period, r];
  }
  const bpm = 60 / (bestPeriod * hopSec);
  return { bpm: Math.round(bpm * 10) / 10, offset: best.phase * hopSec };
}
