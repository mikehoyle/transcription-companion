import { beforeEach, describe, expect, it } from 'vitest';
import { createChain, type ProcessingChain } from './chain';
import { DEFAULT_EQ, initialState, type AppState, type ChannelMode } from '../store';
import {
  FakeAudioContext,
  type FakeBiquadNode,
  type FakeGainNode,
  type FakeNode,
  type FakePannerNode,
} from './fakeAudioContext';

const SAMPLE_RATE = 48000;
const NYQUIST = SAMPLE_RATE / 2;

let ctx: FakeAudioContext;
let chain: ProcessingChain;

/** The nodes chain.ts builds, found by how they are wired rather than by creation order. */
function parts() {
  const input = chain.input as unknown as FakeGainNode;
  const [splitter, bassLp1] = ctx.downstream(input as unknown as FakeNode);
  const matrix = ctx.downstream(splitter) as FakeGainNode[]; // L→outL, R→outL, L→outR, R→outR
  const [bassLp2] = ctx.downstream(bassLp1);
  const [bassGain] = ctx.downstream(bassLp2) as FakeGainNode[];
  const [hp, ...rest] = chain.filters as unknown as FakeBiquadNode[];
  const lp = rest.pop()!;
  return {
    input,
    matrix,
    bassGain,
    bassLowpasses: [bassLp1, bassLp2] as unknown as FakeBiquadNode[],
    hp,
    bands: rest,
    lp,
    panner: ctx.only<FakePannerNode>('panner'),
    volume: chain.output as unknown as FakeGainNode,
  };
}

const state = (patch: Partial<AppState> = {}): AppState => ({ ...initialState(), ...patch });

const apply = (patch: Partial<AppState> = {}, immediate = false) => {
  chain.apply(state(patch), immediate);
  return parts();
};

beforeEach(() => {
  ctx = new FakeAudioContext(SAMPLE_RATE);
  chain = createChain(ctx as unknown as BaseAudioContext);
});

describe('graph', () => {
  it('exposes the filters it puts in series, high-pass first and low-pass last', () => {
    const { hp, bands, lp } = parts();
    expect(chain.filters).toHaveLength(DEFAULT_EQ.bands.length + 2);
    expect(hp.type).toBe('highpass');
    expect(lp.type).toBe('lowpass');
    expect(bands.map((b) => b.type)).toEqual(new Array(DEFAULT_EQ.bands.length).fill('peaking'));
  });

  it('wires the filters one into the next', () => {
    const filters = chain.filters as unknown as FakeNode[];
    for (let i = 1; i < filters.length; i++) {
      expect(ctx.downstream(filters[i - 1])).toContain(filters[i]);
    }
    expect(ctx.downstream(filters[filters.length - 1])).toContain(parts().panner as unknown as FakeNode);
  });

  it('ends at the volume node it hands back as its output', () => {
    const { panner, volume } = parts();
    expect(ctx.downstream(panner as unknown as FakeNode)).toContain(volume as unknown as FakeNode);
  });

  it('takes its input as explicit stereo, so a mono file still feeds both sides', () => {
    const { input } = parts();
    expect(input.channelCount).toBe(2);
    expect(input.channelCountMode).toBe('explicit');
    expect(input.channelInterpretation).toBe('speakers');
  });

  it('splits into four matrix gains and merges them back to two channels', () => {
    const { matrix } = parts();
    expect(matrix).toHaveLength(4);
    const merger = ctx.only('merger');
    // First two gains feed the left output, last two the right.
    const inputs = matrix.map((g) => ctx.edges.find((e) => e.from === (g as unknown as FakeNode) && e.to === merger)!.input);
    expect(inputs).toEqual([0, 0, 1, 1]);
  });

  it('takes the bass-restore path off the input, before the matrix', () => {
    const { bassLowpasses, bassGain } = parts();
    expect(bassLowpasses.map((f) => f.type)).toEqual(['lowpass', 'lowpass']);
    // Two poles at 160 Hz, and silent until karaoke turns it on.
    expect(bassLowpasses.map((f) => f.frequency.value)).toEqual([160, 160]);
    expect(bassGain.gain.value).toBe(0);
  });

  it('releases both ends when disconnected', () => {
    const { input, volume } = parts();
    chain.disconnect();
    expect(input.disconnectCount).toBe(1);
    expect(volume.disconnectCount).toBe(1);
  });
});

describe('channel matrix', () => {
  // out-left = LL*L + RL*R ; out-right = LR*L + RR*R
  const expected: Record<ChannelMode, number[]> = {
    stereo: [1, 0, 0, 1],
    mono: [0.5, 0.5, 0.5, 0.5],
    left: [1, 0, 1, 0],
    right: [0, 1, 0, 1],
    swap: [0, 1, 1, 0],
    karaoke: [1, -1, 1, -1],
  };

  it.each(Object.keys(expected) as ChannelMode[])('routes %s', (channelMode) => {
    const { matrix } = apply({ channelMode });
    expect(matrix.map((g) => g.gain.value)).toEqual(expected[channelMode]);
  });

  it('cancels the centre with the same polarity on both sides', () => {
    // Both outputs get L−R rather than L−R and R−L, so the vocal doesn't
    // reappear when the result is summed to mono.
    const [ll, rl, lr, rr] = apply({ channelMode: 'karaoke' }).matrix.map((g) => g.gain.value);
    expect([ll, rl]).toEqual([lr, rr]);
  });

  it('restores the bass only for karaoke, and only when asked', () => {
    expect(apply({ channelMode: 'karaoke', karaokeKeepBass: true }).bassGain.gain.value).toBe(1);
    expect(apply({ channelMode: 'karaoke', karaokeKeepBass: false }).bassGain.gain.value).toBe(0);
    expect(apply({ channelMode: 'stereo', karaokeKeepBass: true }).bassGain.gain.value).toBe(0);
  });

  // session.ts keeps an unknown mode from getting this far; this is the backstop,
  // because throwing here would kill the graph in the middle of playback.
  it('falls back to stereo for a mode it does not know', () => {
    const { matrix } = apply({ channelMode: 'sideways' as ChannelMode });
    expect(matrix.map((g) => g.gain.value)).toEqual(expected.stereo);
  });
});

describe('EQ', () => {
  const eqWith = (patch: Partial<AppState['eq']>) => ({ ...structuredClone(DEFAULT_EQ), ...patch });

  it('gives each band its own filter', () => {
    const bands = DEFAULT_EQ.bands.map((_, i) => ({ freq: 100 * (i + 1), gain: i - 2, q: 1 + i / 10 }));
    const filters = apply({ eq: eqWith({ bands }) }).bands;
    expect(filters.map((f) => f.frequency.value)).toEqual(bands.map((b) => b.freq));
    expect(filters.map((f) => f.gain.value)).toEqual(bands.map((b) => b.gain));
    expect(filters.map((f) => f.Q.value)).toEqual(bands.map((b) => b.q));
  });

  it('flattens the gains when the EQ is switched off, without moving the bands', () => {
    const bands = DEFAULT_EQ.bands.map((b) => ({ ...b, gain: 6 }));
    const { bands: filters } = apply({ eq: eqWith({ enabled: false, bands }) });
    expect(filters.map((f) => f.gain.value)).toEqual(new Array(bands.length).fill(0));
    expect(filters.map((f) => f.frequency.value)).toEqual(bands.map((b) => b.freq));
  });

  it('parks the high-pass out of the way when it is off', () => {
    expect(apply({ eq: eqWith({ hpOn: false, hpFreq: 300 }) }).hp.frequency.value).toBe(1);
    expect(apply({ eq: eqWith({ hpOn: true, hpFreq: 300 }) }).hp.frequency.value).toBe(300);
  });

  it('parks the low-pass at nyquist when it is off', () => {
    expect(apply({ eq: eqWith({ lpOn: false, lpFreq: 8000 }) }).lp.frequency.value).toBe(NYQUIST);
    expect(apply({ eq: eqWith({ lpOn: true, lpFreq: 8000 }) }).lp.frequency.value).toBe(8000);
  });

  it('never asks a filter for a frequency above nyquist', () => {
    // A 22.05 kHz file cannot have a 20 kHz low-pass; the filter would be unstable.
    ctx = new FakeAudioContext(22050);
    chain = createChain(ctx as unknown as BaseAudioContext);
    const { lp } = apply({ eq: eqWith({ lpOn: true, lpFreq: 20000 }) });
    expect(lp.frequency.value).toBe(11025);
  });

  it('bypasses both shelf filters when the EQ is off, whatever they are set to', () => {
    const { hp, lp } = apply({ eq: eqWith({ enabled: false, hpOn: true, hpFreq: 300, lpOn: true, lpFreq: 4000 }) });
    expect(hp.frequency.value).toBe(1);
    expect(lp.frequency.value).toBe(NYQUIST);
  });

  it('ignores a band with no filter to put it on', () => {
    const eq = eqWith({ bands: [...DEFAULT_EQ.bands, { freq: 15000, gain: 12, q: 1 }] });
    const { bands } = apply({ eq });
    expect(bands).toHaveLength(DEFAULT_EQ.bands.length);
    expect(bands.map((f) => f.frequency.value)).toEqual(DEFAULT_EQ.bands.map((b) => b.freq));
  });

  it('flattens a filter with no band to drive it', () => {
    // Anything but flat here would apply EQ the user can no longer see or change.
    const { bands } = apply({ eq: eqWith({ bands: DEFAULT_EQ.bands.slice(0, 2).map((b) => ({ ...b, gain: 6 })) }) });
    expect(bands.map((f) => f.gain.value)).toEqual([6, 6, 0, 0, 0, 0]);
  });

  it('keeps working after the band list shrinks mid-session', () => {
    apply({ eq: eqWith({ bands: DEFAULT_EQ.bands.map((b) => ({ ...b, gain: 9 })) }) });
    const { bands } = apply({ eq: eqWith({ bands: DEFAULT_EQ.bands.slice(0, 3) }) });
    expect(bands.map((f) => f.gain.value)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe('pan and volume', () => {
  it('passes both straight through', () => {
    const { panner, volume } = apply({ pan: -0.4, volume: 1.5 });
    expect(panner.pan.value).toBeCloseTo(-0.4, 6);
    expect(volume.gain.value).toBe(1.5);
  });

  it('handles the extremes of the pan control', () => {
    expect(apply({ pan: -1 }).panner.pan.value).toBe(-1);
    expect(apply({ pan: 1 }).panner.pan.value).toBe(1);
  });

  it('can silence the output', () => {
    expect(apply({ volume: 0 }).volume.gain.value).toBe(0);
  });
});

describe('how changes are applied', () => {
  it('ramps by default, so a slider does not click', () => {
    ctx.currentTime = 12.5;
    const { volume } = apply({ volume: 0.25 });
    expect(volume.gain.ramps).toHaveLength(1);
    expect(volume.gain.ramps[0]).toMatchObject({ value: 0.25, time: 12.5 });
    expect(volume.gain.cancelCount).toBe(0);
  });

  it('ramps from wherever the clock is now', () => {
    ctx.currentTime = 4;
    apply({ volume: 0.5 });
    ctx.currentTime = 9;
    const { volume } = apply({ volume: 0.75 });
    expect(volume.gain.ramps.map((r) => r.time)).toEqual([4, 9]);
  });

  it('jumps immediately when asked, cancelling anything already scheduled', () => {
    ctx.currentTime = 12.5;
    apply({ volume: 0.25 });
    const { volume } = apply({ volume: 1 }, true);
    expect(volume.gain.value).toBe(1);
    expect(volume.gain.cancelCount).toBe(1);
    expect(volume.gain.ramps).toHaveLength(1); // only the earlier ramp
  });

  it('applies immediately across the whole chain, not just the volume', () => {
    const { matrix, panner, bands } = apply({ channelMode: 'mono', pan: 0.5 }, true);
    for (const param of [...matrix.map((g) => g.gain), panner.pan, ...bands.map((b) => b.frequency)]) {
      expect(param.cancelCount).toBe(1);
      expect(param.ramps).toHaveLength(0);
    }
  });
});
