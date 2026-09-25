import { describe, expect, it } from 'vitest';
import { brownNoise, clicksUntil } from './clickTrack';

describe('clicksUntil', () => {
  it('spaces clicks one beat apart and accents the start of each bar', () => {
    const { clicks, next } = clicksUntil({ time: 0, beat: 0 }, 3, 120, 3);
    expect(clicks.map((c) => c.time)).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
    expect(clicks.map((c) => c.accent)).toEqual([true, false, false, true, false, false]);
    expect(next).toEqual({ time: 3, beat: 0 });
  });

  it('accents nothing with zero beats', () => {
    const { clicks } = clicksUntil({ time: 0, beat: 0 }, 2, 60, 0);
    expect(clicks).toHaveLength(2);
    expect(clicks.every((c) => !c.accent && c.beat === 0)).toBe(true);
  });

  it('accents every click with one beat per bar', () => {
    const { clicks } = clicksUntil({ time: 0, beat: 0 }, 2, 60, 1);
    expect(clicks.every((c) => c.accent)).toBe(true);
  });

  it('carries the bar position across calls', () => {
    const a = clicksUntil({ time: 0, beat: 0 }, 1.1, 120, 4);
    expect(a.clicks).toHaveLength(3);
    const b = clicksUntil(a.next, 2.1, 120, 4);
    expect(b.clicks.map((c) => c.beat)).toEqual([3, 0]);
    expect(b.clicks[1].accent).toBe(true);
  });

  it('schedules nothing before the next click is due', () => {
    const { clicks, next } = clicksUntil({ time: 5, beat: 2 }, 4.9, 100, 4);
    expect(clicks).toEqual([]);
    expect(next).toEqual({ time: 5, beat: 2 });
  });
});

describe('brownNoise', () => {
  const data = brownNoise(48000);

  it('has the RMS of full-range white noise', () => {
    const rms = Math.sqrt(data.reduce((a, v) => a + v * v, 0) / data.length);
    expect(rms).toBeCloseTo(1 / Math.sqrt(3), 5);
  });

  it('loops without a jump at the seam', () => {
    const typicalStep = data.slice(1).reduce((a, v, i) => a + Math.abs(v - data[i]), 0) / (data.length - 1);
    expect(Math.abs(data[0] - data[data.length - 1])).toBeLessThan(typicalStep * 5);
  });

  it('is darker than white noise: neighbouring samples move together', () => {
    let num = 0;
    let den = 0;
    for (let i = 1; i < data.length; i++) {
      num += data[i] * data[i - 1];
      den += data[i] * data[i];
    }
    expect(num / den).toBeGreaterThan(0.9);
  });
});
