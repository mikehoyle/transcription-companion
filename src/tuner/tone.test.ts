import { describe, expect, it } from 'vitest';
import { cosineRamp, envelopeFor, faderGain } from './tone';

// The shape of this ramp is the whole reason note swaps don't tick: a straight line changes
// slope abruptly where it meets the level either side of it, and that corner is audible.
// These assertions pin the two properties that matter — it lands exactly on both levels, and
// it arrives and leaves flat.
describe('cosineRamp', () => {
  const delta = (c: Float32Array, i: number) => Math.abs(c[i + 1] - c[i]);

  // Float32Array rounds, so the endpoints are compared to float precision rather than exactly.
  it('starts and ends on the two levels', () => {
    const up = cosineRamp(0, 0.22);
    expect(up[0]).toBe(0);
    expect(up[up.length - 1]).toBeCloseTo(0.22, 6);
    const down = cosineRamp(0.1, 0);
    expect(down[0]).toBeCloseTo(0.1, 6);
    expect(down[down.length - 1]).toBeCloseTo(0, 6);
  });

  it('moves in one direction only', () => {
    const up = cosineRamp(0, 1);
    for (let i = 1; i < up.length; i++) expect(up[i]).toBeGreaterThanOrEqual(up[i - 1]);
    const down = cosineRamp(1, 0);
    for (let i = 1; i < down.length; i++) expect(down[i]).toBeLessThanOrEqual(down[i - 1]);
  });

  it('leaves no corner at either end', () => {
    const c = cosineRamp(0, 1, 64);
    const mid = delta(c, 31);
    // A straight line would move the same amount at the ends as in the middle; this barely
    // moves at all there, which is what removes the corner.
    expect(delta(c, 0) / mid).toBeLessThan(0.05);
    expect(delta(c, c.length - 2) / mid).toBeLessThan(0.05);
  });

  it('is symmetric about its midpoint', () => {
    const c = cosineRamp(0, 1, 65);
    expect(c[32]).toBeCloseTo(0.5, 6);
    for (let i = 0; i < 32; i++) expect(c[i] + c[64 - i]).toBeCloseTo(1, 6);
  });
});

// A string's damping rises with frequency, so the envelope has to shorten as the pitch goes
// up: one shape slow enough for a bottom E makes every high note sound like a swell.
describe('envelopeFor', () => {
  const E2 = 82.41;
  const G3 = 196;
  const E5 = 659.26;

  it('shortens every stage of the note as the pitch rises', () => {
    const low = envelopeFor(E2);
    const high = envelopeFor(E5);
    for (const k of ['attack', 'length', 'earlyTau', 'knee', 'tailTau'] as const) {
      expect(high[k]).toBeLessThan(low[k]);
    }
    // Two octaves up from the open G, the note is gone in well under half the time.
    expect(envelopeFor(E5).length).toBeLessThan(envelopeFor(G3).length / 2);
  });

  it('is monotonic in pitch', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let midi = 23; midi <= 96; midi++) {
      const { length } = envelopeFor(440 * 2 ** ((midi - 69) / 12));
      expect(length).toBeLessThanOrEqual(previous);
      previous = length;
    }
  });

  it('keeps both ends of the range usable', () => {
    // A bass low B and a mandolin's top E are the extremes the tunings reach.
    expect(envelopeFor(30.87).length).toBeLessThanOrEqual(12);
    expect(envelopeFor(1318.51).length).toBeGreaterThanOrEqual(1.5);
    // Nothing gets an attack short enough to be heard as a click in its own right.
    expect(envelopeFor(1318.51).attack).toBeGreaterThanOrEqual(0.005);
  });

  it('leaves room for the anti-click fade at the end of the shortest ring', () => {
    expect(envelopeFor(4186).length).toBeGreaterThan(0.5);
  });
});

// The fader was linear in amplitude, which left the top of its travel doing almost nothing
// and the tuner too quiet to hear over the instrument at 100%.
describe('faderGain', () => {
  it('runs from silence to full output', () => {
    expect(faderGain(0)).toBe(0);
    expect(faderGain(1)).toBe(1);
  });

  it('rises all the way along', () => {
    for (let v = 0.01; v <= 1; v += 0.01) expect(faderGain(v)).toBeGreaterThan(faderGain(v - 0.01));
  });

  it('puts half travel about 12 dB down', () => {
    expect(20 * Math.log10(faderGain(0.5))).toBeCloseTo(-12, 0);
  });
});
