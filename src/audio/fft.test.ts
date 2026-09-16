import { describe, expect, it } from 'vitest';
import { magnitudeSpectrum } from './fft';

/** The same Hann window the implementation uses. */
const hann = (i: number, n: number) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));

/** Straightforward O(n²) DFT magnitude, as a reference for the fast version. */
function naiveSpectrum(signal: Float32Array, offset: number, n: number): Float32Array {
  const out = new Float32Array(n / 2);
  for (let k = 0; k < n / 2; k++) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const idx = offset + i;
      const v = (idx >= 0 && idx < signal.length ? signal[idx] : 0) * hann(i, n);
      const a = (-2 * Math.PI * k * i) / n;
      re += v * Math.cos(a);
      im += v * Math.sin(a);
    }
    out[k] = (Math.hypot(re, im) * 2) / n;
  }
  return out;
}

const noise = (n: number, seed = 1) => {
  // Deterministic pseudo-random signal, so a failure is always reproducible.
  let s = seed;
  return Float32Array.from({ length: n }, () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 2147483648 - 1;
  });
};

describe('magnitudeSpectrum', () => {
  it('matches a naive DFT on random input', () => {
    const n = 256;
    const signal = noise(n);
    const fast = magnitudeSpectrum(signal, 0, n);
    const slow = naiveSpectrum(signal, 0, n);
    for (let k = 0; k < n / 2; k++) expect(fast[k]).toBeCloseTo(slow[k], 5);
  });

  it('matches a naive DFT when the frame runs off both ends of the signal', () => {
    const n = 128;
    const signal = noise(40, 7);
    for (const offset of [-64, -10, 20, 200]) {
      const fast = magnitudeSpectrum(signal, offset, n);
      const slow = naiveSpectrum(signal, offset, n);
      for (let k = 0; k < n / 2; k++) expect(fast[k]).toBeCloseTo(slow[k], 5);
    }
  });

  it('puts a sine exactly on its own bin, at half its amplitude', () => {
    const n = 1024;
    const bin = 64;
    const amp = 0.8;
    const signal = Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * bin * i) / n));
    const mags = magnitudeSpectrum(signal, 0, n);
    let peak = 0;
    for (let k = 1; k < mags.length; k++) if (mags[k] > mags[peak]) peak = k;
    expect(peak).toBe(bin);
    // A Hann window has a coherent gain of 0.5, so the peak lands at amp/2.
    expect(mags[bin]).toBeCloseTo(amp / 2, 2);
  });

  it('reuses the caller-provided output array', () => {
    const out = new Float32Array(64);
    const result = magnitudeSpectrum(noise(128), 0, 128, out);
    expect(result).toBe(out);
  });

  it('returns silence for an all-zero frame', () => {
    const mags = magnitudeSpectrum(new Float32Array(256), 0, 256);
    expect(Math.max(...mags)).toBe(0);
  });

  it('rejects sizes that are not a power of two', () => {
    expect(() => magnitudeSpectrum(noise(100), 0, 100)).toThrow(/power of two/);
  });
});
