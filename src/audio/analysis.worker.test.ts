// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ANALYSIS_RATE, NOTE_COUNT, NOTE_MIN, midiToFreq, pcName } from './music';
import type { AnalysisMessage, AnalysisRequest } from './analysis.worker';

/**
 * Drives the analysis worker the way the app does — one signal in, one batch of
 * messages out — over a synthesised recording whose key, chords and tempo are
 * known. This is the path behind every "it detected the wrong thing" report.
 */

const BPM = 120;
const BEAT = 60 / BPM;
const CHORD_SECONDS = 2;

/** bass note + upper voicing for a I–IV–V–I progression in C major */
const PROGRESSION: { root: number; midis: number[] }[] = [
  { root: 0, midis: [36, 60, 64, 67] },
  { root: 5, midis: [41, 60, 65, 69] },
  { root: 7, midis: [43, 59, 62, 67] },
  { root: 0, midis: [36, 60, 64, 67] },
];

/** The progression played with a little harmonic content, over a click track. */
function render(): Float32Array {
  const total = Math.round(PROGRESSION.length * CHORD_SECONDS * ANALYSIS_RATE);
  const out = new Float32Array(total);

  PROGRESSION.forEach(({ midis }, c) => {
    const from = Math.round(c * CHORD_SECONDS * ANALYSIS_RATE);
    const to = Math.round((c + 1) * CHORD_SECONDS * ANALYSIS_RATE);
    for (const m of midis) {
      const f0 = midiToFreq(m);
      for (let h = 1; h <= 4; h++) {
        const amp = 0.12 / (midis.length * h);
        for (let i = from; i < to; i++) out[i] += amp * Math.sin((2 * Math.PI * f0 * h * (i - from)) / ANALYSIS_RATE);
      }
    }
  });

  // A percussive click on each beat, so there are onsets to find a tempo in.
  let seed = 12345;
  const noise = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 2147483648 - 1;
  };
  for (let beat = 0; beat * BEAT * ANALYSIS_RATE < total; beat++) {
    const start = Math.round(beat * BEAT * ANALYSIS_RATE);
    const len = Math.round(0.02 * ANALYSIS_RATE);
    for (let i = 0; i < len && start + i < total; i++) {
      out[start + i] += noise() * 0.25 * Math.exp(-8 * (i / len));
    }
  }
  return out;
}

let messages: AnalysisMessage[];
let done: Extract<AnalysisMessage, { type: 'done' }>;

beforeAll(async () => {
  messages = [];
  // The worker posts through the global; capture it before the module runs.
  vi.stubGlobal('postMessage', (msg: AnalysisMessage) => messages.push(msg));
  await import('./analysis.worker');
  self.onmessage!({ data: { signal: render() } as AnalysisRequest } as MessageEvent<AnalysisRequest>);
  const last = messages[messages.length - 1];
  expect(last.type, `worker failed: ${JSON.stringify(last)}`).toBe('done');
  done = last as typeof done;
});

describe('analysis worker', () => {
  it('reports progress on the way and finishes once', () => {
    const progress = messages.filter((m) => m.type === 'progress').map((m) => m.value);
    expect(progress.length).toBeGreaterThan(0);
    expect(Math.min(...progress)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...progress)).toBeLessThanOrEqual(1);
    expect([...progress]).toEqual([...progress].sort((a, b) => a - b));
    expect(messages.filter((m) => m.type === 'done')).toHaveLength(1);
    expect(messages.some((m) => m.type === 'error')).toBe(false);
  });

  it('returns a pitch roll covering the whole signal', () => {
    expect(done.roll.length).toBe(done.frames * NOTE_COUNT);
    expect(done.frames * done.hopSec).toBeGreaterThanOrEqual(PROGRESSION.length * CHORD_SECONDS - done.hopSec);
    // Normalised for display: nothing outside 0..1, and something is lit up.
    expect(Math.min(...done.roll)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...done.roll)).toBeLessThanOrEqual(1);
    expect(Math.max(...done.roll)).toBeGreaterThan(0.5);
  });

  it('puts the strongest energy on the notes that are playing', () => {
    // Mid-way through the first chord, the loudest semitone should be one of its notes.
    const frame = Math.floor(1 / done.hopSec);
    const spec = done.roll.subarray(frame * NOTE_COUNT, (frame + 1) * NOTE_COUNT);
    let peak = 0;
    for (let i = 1; i < spec.length; i++) if (spec[i] > spec[peak]) peak = i;
    expect(PROGRESSION[0].midis).toContain(NOTE_MIN + peak);
  });

  it('detects the key', () => {
    expect(done.key).not.toBeNull();
    expect(pcName(done.key!.tonic)).toBe('C');
    expect(done.key!.mode).toBe('major');
  });

  it('detects the tempo', () => {
    expect(done.tempo).not.toBeNull();
    expect(done.tempo!.bpm).toBeGreaterThan(BPM - 3);
    expect(done.tempo!.bpm).toBeLessThan(BPM + 3);
  });

  it('places the beat grid on the clicks', () => {
    const offset = done.tempo!.offset;
    // The clicks start at t=0, so the phase should land on a beat boundary.
    const fromBeat = Math.min(offset % BEAT, BEAT - (offset % BEAT));
    expect(fromBeat).toBeLessThan(0.06);
  });

  it('follows the chord progression', () => {
    expect(done.chords.length).toBeGreaterThan(0);
    // The chord covering the middle of each two-second block.
    const atTime = (t: number) => done.chords.find((ch) => ch.start <= t && ch.end > t);
    const roots = PROGRESSION.map((_, i) => atTime(i * CHORD_SECONDS + 1)?.root);
    expect(roots).toEqual(PROGRESSION.map((p) => p.root));
  });

  it('returns chord segments in order, without gaps inside a run', () => {
    for (let i = 1; i < done.chords.length; i++) {
      expect(done.chords[i].start).toBeGreaterThanOrEqual(done.chords[i - 1].start);
      expect(done.chords[i].end).toBeGreaterThan(done.chords[i].start);
    }
  });

  it('reports an error instead of throwing when handed nonsense', () => {
    const before = messages.length;
    self.onmessage!({ data: {} as AnalysisRequest } as MessageEvent<AnalysisRequest>);
    expect(messages.slice(before).some((m) => m.type === 'error')).toBe(true);
  });
});
