import { describe, expect, it } from 'vitest';
import { cosineRamp } from './tone';

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
