// A metronome that runs on its own AudioContext, with no file loaded and
// nothing to do with the playback engine or its beat grid.

/** One metronome click: a short sine blip, higher when accented. Shared with the engine's metronome. */
export function playClick(ctx: BaseAudioContext, dest: AudioNode, when: number, accent: boolean, volume: number) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.value = accent ? 1760 : 1175;
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(0.5 * volume, when + 0.002);
  g.gain.exponentialRampToValueAtTime(0.001, when + 0.06);
  osc.connect(g).connect(dest);
  osc.start(when);
  osc.stop(when + 0.08);
}

export interface Click {
  time: number;
  /** Position in the bar, from 0; always 0 when there are no bars. */
  beat: number;
  accent: boolean;
}

/**
 * The clicks from `next` (the time and bar position of the next unscheduled beat) up to
 * `until`, and where the one after them falls. With `beats` 0 every click is the same.
 */
export function clicksUntil(next: { time: number; beat: number }, until: number, bpm: number, beats: number): { clicks: Click[]; next: { time: number; beat: number } } {
  const clicks: Click[] = [];
  let { time, beat } = next;
  const step = 60 / bpm;
  while (time < until) {
    clicks.push({ time, beat, accent: beats > 0 && beat === 0 });
    time += step;
    beat = beats > 0 ? (beat + 1) % beats : 0;
  }
  return { clicks, next: { time, beat } };
}

const LOOKAHEAD = 0.12; // seconds of clicks scheduled ahead of the audio clock
const TICK_MS = 25;
/**
 * The noise is only there to keep a sleepy Bluetooth speaker awake, so even full volume on
 * its slider is quiet.
 */
const NOISE_MAX_GAIN = 0.0075;
const NOISE_SECONDS = 2;

/**
 * Brown-ish noise: white noise through a leaky integrator, which rolls off the hiss above a
 * few hundred Hz. The drift is levelled out so the buffer's two ends meet and it loops
 * without a click, and it's scaled to the RMS of full-range white noise (1/√3).
 */
export function brownNoise(length: number, random: () => number = Math.random): Float32Array {
  const data = new Float32Array(length);
  let last = 0;
  for (let i = 0; i < length; i++) {
    last = (last + 0.02 * (random() * 2 - 1)) / 1.02;
    data[i] = last;
  }
  if (length < 2) return data;
  const drift = data[length - 1] - data[0];
  let mean = 0;
  for (let i = 0; i < length; i++) {
    data[i] -= (drift * i) / (length - 1);
    mean += data[i] / length;
  }
  let sq = 0;
  for (let i = 0; i < length; i++) {
    data[i] -= mean;
    sq += data[i] * data[i];
  }
  const rms = Math.sqrt(sq / length);
  if (rms > 0) {
    const k = 1 / Math.sqrt(3) / rms;
    for (let i = 0; i < length; i++) data[i] *= k;
  }
  return data;
}

export class ClickTrack {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private volume = 0.8;
  private noiseGain: GainNode | null = null;
  private noiseSource: AudioBufferSourceNode | null = null;
  private noiseOn = false;
  private noiseVolume = 0.12;
  private timer: ReturnType<typeof setInterval> | null = null;
  private next = { time: 0, beat: 0 };
  private bpm = 120;
  private beats = 4;
  /** Called (on the main thread, as close as timers allow) when each click sounds. */
  onBeat: ((beat: number, accent: boolean) => void) | null = null;

  get running() {
    return this.timer !== null;
  }

  /** Tempo and bar changes land on the next click, without restarting the count. */
  set(bpm: number, beats: number) {
    this.bpm = bpm;
    if (beats !== this.beats) {
      this.beats = beats;
      // Start the new bar on the next click, so the accent never lands mid-way through a changed count.
      this.next.beat = 0;
    }
  }

  /** 0–1; applies straight away, including to clicks already scheduled. */
  setVolume(volume: number) {
    this.volume = volume;
    if (this.gain) this.gain.gain.value = volume;
  }

  /** A faint, steady hiss that plays alongside the clicks while the metronome runs; `volume` 0–1. */
  setNoise(on: boolean, volume: number) {
    this.noiseOn = on;
    this.noiseVolume = volume;
    if (this.noiseGain) this.noiseGain.gain.value = volume * NOISE_MAX_GAIN;
    this.syncNoise();
  }

  /** Must be called from a user gesture the first time: that is what lets the context make sound. */
  start() {
    if (this.timer) return;
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.next = { time: this.ctx.currentTime + 0.05, beat: 0 };
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.syncNoise();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.syncNoise();
  }

  dispose() {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
    this.gain = null;
    this.noiseGain = null;
  }

  /** Noise sounds only while the clicks do, and only when switched on. */
  private syncNoise() {
    const { ctx } = this;
    if (!ctx || !this.running || !this.noiseOn) {
      this.noiseSource?.stop();
      this.noiseSource = null;
      return;
    }
    if (this.noiseSource) return;
    if (!this.noiseGain) {
      this.noiseGain = ctx.createGain();
      this.noiseGain.connect(ctx.destination);
    }
    this.noiseGain.gain.value = this.noiseVolume * NOISE_MAX_GAIN;
    const buffer = ctx.createBuffer(1, Math.round(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate);
    buffer.getChannelData(0).set(brownNoise(buffer.length));
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(this.noiseGain);
    src.start();
    this.noiseSource = src;
  }

  private tick() {
    const { ctx, gain } = this;
    if (!ctx || !gain) return;
    // After a stall (a background tab throttles timers) pick up from now rather than firing a burst of late clicks.
    if (this.next.time < ctx.currentTime) this.next.time = ctx.currentTime + 0.01;
    const { clicks, next } = clicksUntil(this.next, ctx.currentTime + LOOKAHEAD, this.bpm, this.beats);
    this.next = next;
    for (const c of clicks) {
      playClick(ctx, gain, c.time, c.accent, 1);
      const delay = (c.time - ctx.currentTime) * 1000;
      setTimeout(() => this.timer && this.onBeat?.(c.beat, c.accent), Math.max(0, delay));
    }
  }
}
