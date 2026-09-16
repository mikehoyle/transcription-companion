import type { AppState, ChannelMode } from '../store';

/** [LL, RL, LR, RR]: out-left = LL*L + RL*R ; out-right = LR*L + RR*R */
const MATRIX: Record<ChannelMode, [number, number, number, number]> = {
  stereo: [1, 0, 0, 1],
  mono: [0.5, 0.5, 0.5, 0.5],
  left: [1, 0, 1, 0],
  right: [0, 1, 0, 1],
  swap: [0, 1, 1, 0],
  // Phase-cancel the centre (where lead vocals usually sit). Same-polarity
  // (L−R) on both sides so it doesn't vanish when summed to mono.
  karaoke: [1, -1, 1, -1],
};

export interface ProcessingChain {
  input: AudioNode;
  output: AudioNode;
  filters: BiquadFilterNode[]; // in series, for drawing the EQ curve
  apply(state: AppState, immediate?: boolean): void;
  disconnect(): void;
}

/**
 * Post-stretch processing: channel matrix (mono / L / R / karaoke …),
 * optional bass restore for karaoke, parametric EQ, pan and volume.
 * Shared by live playback and offline export so they sound identical.
 */
export function createChain(ctx: BaseAudioContext): ProcessingChain {
  const input = ctx.createGain();
  const splitter = ctx.createChannelSplitter(2);
  const merger = ctx.createChannelMerger(2);
  const gains = [0, 1, 2, 3].map(() => ctx.createGain());
  input.channelCount = 2;
  input.channelCountMode = 'explicit';
  input.channelInterpretation = 'speakers';
  input.connect(splitter);
  // L -> outL, R -> outL, L -> outR, R -> outR
  splitter.connect(gains[0], 0);
  splitter.connect(gains[1], 1);
  splitter.connect(gains[2], 0);
  splitter.connect(gains[3], 1);
  gains[0].connect(merger, 0, 0);
  gains[1].connect(merger, 0, 0);
  gains[2].connect(merger, 0, 1);
  gains[3].connect(merger, 0, 1);

  const sum = ctx.createGain();
  merger.connect(sum);

  // Bass restore path for karaoke: centre-cancel also removes bass & kick.
  const bassLp1 = ctx.createBiquadFilter();
  const bassLp2 = ctx.createBiquadFilter();
  bassLp1.type = bassLp2.type = 'lowpass';
  bassLp1.frequency.value = bassLp2.frequency.value = 160;
  const bassGain = ctx.createGain();
  bassGain.gain.value = 0;
  input.connect(bassLp1).connect(bassLp2).connect(bassGain).connect(sum);

  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.Q.value = Math.SQRT1_2; // Butterworth
  const bands = [0, 1, 2, 3, 4, 5].map(() => {
    const f = ctx.createBiquadFilter();
    f.type = 'peaking';
    return f;
  });
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = Math.SQRT1_2; // Butterworth
  const filters = [hp, ...bands, lp];

  let node: AudioNode = sum;
  for (const f of filters) node = node.connect(f);

  const panner = ctx.createStereoPanner();
  const volume = ctx.createGain();
  node.connect(panner).connect(volume);

  const nyquist = ctx.sampleRate / 2;

  const set = (param: AudioParam, value: number, immediate: boolean) => {
    if (immediate) {
      param.cancelScheduledValues(0);
      param.value = value;
    } else {
      param.setTargetAtTime(value, ctx.currentTime, 0.015);
    }
  };

  return {
    input,
    output: volume,
    filters,
    // Settings are validated on the way in (see session.ts), but a mismatch here
    // would take the whole graph down mid-playback, so fall back rather than throw.
    apply(s, immediate = false) {
      const m = MATRIX[s.channelMode] ?? MATRIX.stereo;
      gains.forEach((g, i) => {
        set(g.gain, m[i], immediate);
      });
      set(bassGain.gain, s.channelMode === 'karaoke' && s.karaokeKeepBass ? 1 : 0, immediate);

      const eq = s.eq;
      set(hp.frequency, eq.enabled && eq.hpOn ? eq.hpFreq : 1, immediate);
      set(lp.frequency, eq.enabled && eq.lpOn ? Math.min(eq.lpFreq, nyquist) : nyquist, immediate);
      // Driven by the filters that exist, not by the band list: a peaking filter
      // at 0 dB is transparent whatever else it is set to, so a band with no
      // filter is dropped and a filter with no band goes flat.
      bands.forEach((filter, i) => {
        const b = eq.bands[i];
        if (!b) {
          set(filter.gain, 0, immediate);
          return;
        }
        set(filter.frequency, b.freq, immediate);
        set(filter.Q, b.q, immediate);
        set(filter.gain, eq.enabled ? b.gain : 0, immediate);
      });
      set(panner.pan, s.pan, immediate);
      set(volume.gain, s.volume, immediate);
    },
    disconnect() {
      input.disconnect();
      volume.disconnect();
    },
  };
}
