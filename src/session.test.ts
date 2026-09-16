import { describe, expect, it } from 'vitest';
import { SESSION_KEYS, sessionPatch } from './session';
import { DEFAULT_EQ, initialState } from './store';

/** A complete, valid session — every key set to something other than its default. */
const fullSession = () => ({
  rate: 0.75,
  semitones: -3,
  cents: 12,
  formant: true,
  volume: 1.2,
  pan: -0.4,
  channelMode: 'karaoke',
  karaokeKeepBass: false,
  eq: {
    enabled: true,
    hpOn: true,
    hpFreq: 180,
    lpOn: true,
    lpFreq: 6000,
    bands: DEFAULT_EQ.bands.map((b, i) => ({ ...b, gain: i - 2 })),
  },
  loop: { enabled: true, start: 10.5, end: 22.25 },
  loopGap: 1.5,
  countIn: { onPlay: true, onLoop: false, bars: 2 },
  trainer: { enabled: true, startRate: 0.6, targetRate: 1, step: 0.05, repsPerStep: 3, rep: 7 },
  markers: [{ id: 'm1', time: 30, label: 'chorus', color: 2 }],
  loops: [{ id: 'l1', name: 'A section', start: 1, end: 2 }],
  tempo: { bpm: 96.5, offset: 0.2, beatsPerBar: 3, detectedBpm: 96.5 },
  gridVisible: true,
  snapToGrid: true,
  metronome: { on: true, volume: 0.4 },
  transposeDisplay: 2,
});

describe('sessionPatch', () => {
  it('keeps every field of a valid session', () => {
    const patch = sessionPatch(fullSession());
    expect(Object.keys(patch).sort()).toEqual([...SESSION_KEYS].sort());
    expect(patch.rate).toBe(0.75);
    expect(patch.channelMode).toBe('karaoke');
    expect(patch.loop).toEqual({ enabled: true, start: 10.5, end: 22.25 });
    expect(patch.tempo).toEqual({ bpm: 96.5, offset: 0.2, beatsPerBar: 3, detectedBpm: 96.5 });
    expect(patch.markers).toEqual([{ id: 'm1', time: 30, label: 'chorus', color: 2 }]);
    expect(patch.loops).toEqual([{ id: 'l1', name: 'A section', start: 1, end: 2 }]);
  });

  it('ignores keys that are absent, so the current value survives', () => {
    expect(sessionPatch({ rate: 0.5 })).toEqual({ rate: 0.5 });
    expect(sessionPatch({})).toEqual({});
  });

  it('ignores keys that are not part of a session', () => {
    const patch = sessionPatch({ rate: 0.5, file: { name: 'evil' }, helpOpen: true } as Record<string, unknown>);
    expect(patch).toEqual({ rate: 0.5 });
  });

  it('never restores trainer progress', () => {
    expect(sessionPatch(fullSession()).trainer!.rep).toBe(0);
  });

  it('sorts markers by time and drops unusable ones', () => {
    const patch = sessionPatch({
      markers: [
        { id: 'b', time: 30, label: 'late' },
        'not a marker',
        { id: 'a', time: 5, label: 'early' },
        { id: 'c', time: 'soon' },
        null,
        { id: 'd' },
      ],
    });
    expect(patch.markers!.map((m) => m.label)).toEqual(['early', 'late']);
  });

  it('fills in fields a marker is missing', () => {
    const [marker] = sessionPatch({ markers: [{ time: 1 }] }).markers!;
    expect(marker.label).toBe('');
    expect(marker.color).toBe(0);
    expect(marker.id).toBeTruthy();
  });

  it('drops saved loops that are empty or backwards', () => {
    const patch = sessionPatch({
      loops: [
        { id: 'ok', name: 'good', start: 1, end: 2 },
        { id: 'empty', name: 'zero length', start: 3, end: 3 },
        { id: 'backwards', name: 'reversed', start: 9, end: 4 },
      ],
    });
    expect(patch.loops!.map((l) => l.id)).toEqual(['ok']);
  });

  // Each of these used to pass the old `typeof value === typeof default` check and
  // then throw — in render for the first two, inside the audio chain for the rest.
  describe('rejects values that used to crash the app', () => {
    it('null where an object is expected', () => {
      expect(sessionPatch({ loop: null, countIn: null, tempo: null, eq: null })).toEqual({});
    });

    it('a non-array in a list field', () => {
      expect(sessionPatch({ markers: {}, loops: 'nope' })).toEqual({});
    });

    it('an unknown channel mode', () => {
      expect(sessionPatch({ channelMode: 'evil' })).toEqual({});
      expect(sessionPatch({ channelMode: 'mono' })).toEqual({ channelMode: 'mono' });
    });

    it('an EQ with the wrong number of bands', () => {
      for (const bands of [[], new Array(10).fill({ freq: 100, gain: 0, q: 1 }), 'nope']) {
        const eq = sessionPatch({ eq: { enabled: true, bands } }).eq!;
        expect(eq.bands).toHaveLength(DEFAULT_EQ.bands.length);
      }
    });
  });

  describe('rejects values outside the range the UI allows', () => {
    it.each([
      ['rate', [NaN, Infinity, 0, -1, 5, '0.5']],
      ['semitones', [999, -999, NaN]],
      ['cents', [500, -500]],
      ['volume', [-1, 99]],
      ['pan', [-2, 2]],
      ['loopGap', [-1, 1e9]],
      ['transposeDisplay', [1e9, NaN]],
    ])('%s', (key, values) => {
      for (const value of values as unknown[]) {
        expect(sessionPatch({ [key]: value })).toEqual({});
      }
    });

    it('falls back per field inside a compound value', () => {
      const defaults = initialState();
      const patch = sessionPatch({ tempo: { bpm: 0, offset: 'x', beatsPerBar: 99, detectedBpm: 'no' } });
      expect(patch.tempo).toEqual({
        bpm: defaults.tempo.bpm,
        offset: defaults.tempo.offset,
        beatsPerBar: defaults.tempo.beatsPerBar,
        detectedBpm: null,
      });
    });

    it('clamps an EQ band to usable filter settings', () => {
      const eq = sessionPatch({
        eq: { bands: [{ freq: 0, gain: 500, q: -3 }, ...DEFAULT_EQ.bands.slice(1)] },
      }).eq!;
      expect(eq.bands[0]).toEqual(DEFAULT_EQ.bands[0]);
    });
  });

  it('rounds values the UI only ever produces as integers', () => {
    expect(sessionPatch({ semitones: 3.7, cents: -20.2 })).toEqual({ semitones: 4, cents: -20 });
  });

  it('caps runaway marker and loop counts', () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({ id: `m${i}`, time: i, label: '' }));
    expect(sessionPatch({ markers: many }).markers!.length).toBeLessThanOrEqual(1000);
  });

  it('accepts a session written by an older version that had fewer fields', () => {
    // Markers gained colours after the first release; sessions from before that
    // have none, and loop/tempo shapes have only ever grown.
    const patch = sessionPatch({ rate: 0.8, markers: [{ id: 'a', time: 4, label: 'riff' }] });
    expect(patch.markers).toEqual([{ id: 'a', time: 4, label: 'riff', color: 0 }]);
    expect(patch.rate).toBe(0.8);
  });
});
