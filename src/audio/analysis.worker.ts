/// <reference lib="webworker" />
import { magnitudeSpectrum } from './fft';
import {
  ANALYSIS_RATE,
  FRAME_SIZE,
  NOTE_COUNT,
  NOTE_MIN,
  chroma,
  detectKey,
  detectTempo,
  guessChord,
  semitoneSpectrum,
} from './music';
import type { ChordSegment } from '../store';

export interface AnalysisRequest {
  signal: Float32Array; // mono @ ANALYSIS_RATE
}

export type AnalysisMessage =
  | { type: 'progress'; value: number }
  | {
      type: 'done';
      hopSec: number;
      frames: number;
      roll: Float32Array;
      chords: ChordSegment[];
      key: { tonic: number; mode: 'major' | 'minor' } | null;
      tempo: { bpm: number; offset: number } | null;
    }
  | { type: 'error'; message: string };

const post = (msg: AnalysisMessage, transfer: Transferable[] = []) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<AnalysisRequest>) => {
  try {
    analyse(e.data.signal);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

function analyse(signal: Float32Array) {
  // --- pitch roll + chords (hop ~46 ms, longer hop for very long files) ---
  let hop = 1024;
  while (signal.length / hop > 16000) hop *= 2;
  const hopSec = hop / ANALYSIS_RATE;
  const frames = Math.max(1, Math.ceil(signal.length / hop));
  const raw = new Float32Array(frames * NOTE_COUNT);
  const energy = new Float32Array(frames);
  const mags = new Float32Array(FRAME_SIZE / 2);
  const spec = new Float32Array(NOTE_COUNT);

  for (let f = 0; f < frames; f++) {
    magnitudeSpectrum(signal, f * hop - FRAME_SIZE / 2, FRAME_SIZE, mags);
    semitoneSpectrum(mags, ANALYSIS_RATE, FRAME_SIZE, spec);
    raw.set(spec, f * NOTE_COUNT);
    let e = 0;
    for (const v of spec) e += v * v;
    energy[f] = Math.sqrt(e);
    if (f % 200 === 0) post({ type: 'progress', value: (f / frames) * 0.8 });
  }

  // Normalise roll to 0..1 over a 50 dB range below the loud end.
  const sample: number[] = [];
  const stride = Math.max(1, Math.floor(raw.length / 50000));
  for (let i = 0; i < raw.length; i += stride) sample.push(raw[i]);
  sample.sort((a, b) => a - b);
  const ref = Math.max(sample[Math.floor(sample.length * 0.999)] ?? 1e-6, 1e-6);
  const roll = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const db = 20 * Math.log10(Math.max(raw[i], 1e-9) / ref);
    roll[i] = Math.min(1, Math.max(0, 1 + db / 50));
  }

  // --- chords: chroma smoothed over ~0.5 s, bass from the low register ---
  const sortedEnergy = Array.from(energy).sort((a, b) => a - b);
  const silence = (sortedEnergy[Math.floor(sortedEnergy.length * 0.95)] ?? 0) * 0.05;
  const half = Math.max(1, Math.round(0.25 / hopSec));
  const labels: (string | null)[] = new Array(frames).fill(null);
  const guesses: (ReturnType<typeof guessChord>)[] = new Array(frames).fill(null);
  const keyChroma = new Float64Array(12);
  const frameSpec = (f: number) => raw.subarray(f * NOTE_COUNT, (f + 1) * NOTE_COUNT);

  for (let f = 0; f < frames; f++) {
    if (energy[f] <= silence) continue;
    const acc = new Float32Array(12);
    const lowAcc = new Float32Array(28); // E1..G3
    for (let g = Math.max(0, f - half); g <= Math.min(frames - 1, f + half); g++) {
      const s = frameSpec(g);
      const c = chroma(s);
      for (let i = 0; i < 12; i++) acc[i] += c[i];
      for (let i = 0; i < lowAcc.length; i++) lowAcc[i] += s[4 + i];
    }
    const c = chroma(frameSpec(f));
    for (let i = 0; i < 12; i++) keyChroma[i] += c[i];
    let bassIdx = -1;
    let bassMax = 0;
    let lowMax = 0;
    for (let i = 0; i < lowAcc.length; i++) lowMax = Math.max(lowMax, lowAcc[i]);
    for (let i = 0; i < lowAcc.length; i++) {
      // lowest note that is reasonably strong
      if (lowAcc[i] > lowMax * 0.6 && lowAcc[i] >= (lowAcc[i - 1] ?? 0) && lowAcc[i] >= (lowAcc[i + 1] ?? 0)) {
        bassIdx = i;
        bassMax = lowAcc[i];
        break;
      }
    }
    const bassPc = bassIdx >= 0 && bassMax > 0 ? (NOTE_MIN + 4 + bassIdx) % 12 : undefined;
    const guess = guessChord(acc, bassPc);
    guesses[f] = guess;
    labels[f] = guess ? `${guess.root}|${guess.suffix}|${guess.bass}` : null;
    if (f % 400 === 0) post({ type: 'progress', value: 0.8 + (f / frames) * 0.1 });
  }

  // mode filter to remove flicker
  const win = Math.max(2, Math.round(0.35 / hopSec));
  const filtered: (string | null)[] = new Array(frames);
  for (let f = 0; f < frames; f++) {
    const counts = new Map<string | null, number>();
    for (let g = Math.max(0, f - win); g <= Math.min(frames - 1, f + win); g++) {
      counts.set(labels[g], (counts.get(labels[g]) ?? 0) + 1);
    }
    let best: string | null = labels[f];
    let bestN = 0;
    for (const [k, n] of counts) if (n > bestN) [best, bestN] = [k, n];
    filtered[f] = best;
  }

  let segs: { start: number; end: number; label: string | null }[] = [];
  for (let f = 0; f < frames; f++) {
    const last = segs[segs.length - 1];
    if (last && last.label === filtered[f]) last.end = (f + 1) * hopSec;
    else segs.push({ start: f * hopSec, end: (f + 1) * hopSec, label: filtered[f] });
  }
  // absorb very short segments into the previous one
  const merged: typeof segs = [];
  for (const s of segs) {
    const prev = merged[merged.length - 1];
    if (prev && s.end - s.start < 0.3) prev.end = s.end;
    else if (prev && prev.label === s.label) prev.end = s.end;
    else merged.push({ ...s });
  }
  segs = merged;
  const chords: ChordSegment[] = segs
    .filter((s) => s.label !== null)
    .map((s) => {
      const [root, suffix, bass] = s.label!.split('|');
      return { start: s.start, end: s.end, root: Number(root), suffix, bass: bass === 'null' ? null : Number(bass) };
    });

  const key = keyChroma.some((v) => v > 0) ? (({ tonic, mode }) => ({ tonic, mode }))(detectKey(keyChroma)) : null;

  // --- tempo: spectral-flux onset envelope at ~23 ms hop ---
  post({ type: 'progress', value: 0.92 });
  const oHop = 512;
  const oSize = 1024;
  const oFrames = Math.floor(signal.length / oHop);
  const env = new Float32Array(oFrames);
  let prev = new Float32Array(oSize / 2);
  let cur = new Float32Array(oSize / 2);
  for (let f = 0; f < oFrames; f++) {
    magnitudeSpectrum(signal, f * oHop, oSize, cur);
    let flux = 0;
    for (let i = 1; i < 300; i++) {
      const d = Math.log1p(1000 * cur[i]) - Math.log1p(1000 * prev[i]);
      if (d > 0) flux += d;
    }
    env[f] = flux;
    [prev, cur] = [cur, prev];
  }
  // subtract local mean (adaptive threshold)
  const m = 8;
  const detrended = new Float32Array(oFrames);
  for (let f = 0; f < oFrames; f++) {
    let s = 0;
    let n = 0;
    for (let g = Math.max(0, f - m); g <= Math.min(oFrames - 1, f + m); g++, n++) s += env[g];
    detrended[f] = Math.max(0, env[f] - s / n);
  }
  const tempo = detectTempo(detrended, oHop / ANALYSIS_RATE);
  if (tempo) {
    // envelope frames are indexed by their start; onsets sit mid-frame
    const period = 60 / tempo.bpm;
    tempo.offset = (tempo.offset + oSize / 2 / ANALYSIS_RATE) % period;
  }

  post({ type: 'done', hopSec, frames, roll, chords, key, tempo }, [roll.buffer]);
}
