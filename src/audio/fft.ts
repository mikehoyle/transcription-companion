// Iterative radix-2 FFT with cached tables. Sizes must be powers of two.

interface Tables {
  rev: Uint32Array;
  cos: Float64Array;
  sin: Float64Array;
  window: Float32Array;
}

const cache = new Map<number, Tables>();

function tables(n: number): Tables {
  let t = cache.get(n);
  if (t) return t;
  const bits = Math.log2(n);
  if (!Number.isInteger(bits)) throw new Error(`FFT size ${n} is not a power of two`);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  const window = new Float32Array(n);
  for (let i = 0; i < n; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  t = { rev, cos, sin, window };
  cache.set(n, t);
  return t;
}

/**
 * Hann-windowed magnitude spectrum of `n` samples starting at `offset`
 * (zero-padded outside the signal). Returns n/2 magnitudes.
 */
export function magnitudeSpectrum(signal: Float32Array, offset: number, n: number, out?: Float32Array): Float32Array {
  const { rev, cos, sin, window } = tables(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const idx = offset + i;
    const v = idx >= 0 && idx < signal.length ? signal[idx] : 0;
    re[rev[i]] = v * window[i];
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let j = 0; j < half; j++) {
        const k = j * step;
        const a = start + j;
        const b = a + half;
        const tr = re[b] * cos[k] + im[b] * sin[k];
        const ti = -re[b] * sin[k] + im[b] * cos[k];
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  const mags = out ?? new Float32Array(n / 2);
  const scale = 2 / n;
  for (let i = 0; i < n / 2; i++) mags[i] = Math.hypot(re[i], im[i]) * scale;
  return mags;
}
