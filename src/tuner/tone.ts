// The tuner's sound: one oscillator per sounding voice, fed a PeriodicWave built from a
// harmonic profile. Output only — the tuner never opens the microphone.

import type { PlayMode, Timbre } from './tunings';

/**
 * Relative amplitude of each harmonic, fundamental first. A fundamental-heavy tone is the
 * easiest to match by ear; the richer ones put energy in the upper partials, where beats
 * against a slightly out-of-tune string are much easier to hear.
 */
const HARMONICS: Record<Timbre, number[]> = {
  pure: [1],
  soft: [1, 0.14, 0.05, 0.02],
  rich: [1, 0.55, 0.36, 0.22, 0.16, 0.11, 0.08, 0.05],
};

/** Attack at the reference pitch; higher notes get a shorter one. See `envelopeFor`. */
const ATTACK = 0.015;
/** The shortest attack any note gets: below this the onset itself is audible as a click. */
const ATTACK_MIN = 0.006;
/** Fade when a note is deliberately stopped. */
const RELEASE = 0.08;
/**
 * Everything is scheduled this far ahead of `currentTime`, which the main thread only sees
 * advance once per render quantum. A curve timed at `currentTime` is already behind the
 * audio thread, which then enters it part-way along — and since these curves start at the
 * level the note is already at, being dropped into the middle of one is a step. The
 * lookahead also lets both halves of a swap share a single instant, so the outgoing fade
 * and the incoming attack line up exactly. Twenty milliseconds is imperceptible here.
 */
const LOOKAHEAD = 0.02;

/**
 * A raised-cosine ramp between two levels. Every envelope edge uses one of these rather than
 * a straight line: a linear ramp changes slope abruptly at both ends, and those corners are
 * broadband — with a harmonically rich tone they are audible as a tick at the moment a note
 * reaches full volume or a fade reaches silence.
 */
export function cosineRamp(from: number, to: number, steps = 64): Float32Array {
  const curve = new Float32Array(steps);
  for (let i = 0; i < steps; i++) curve[i] = from + (to - from) * 0.5 * (1 - Math.cos((Math.PI * i) / (steps - 1)));
  return curve;
}

/**
 * Peak level of a single voice. The tuner is monophonic — a new note cuts whatever is still
 * ringing, and the swap crossfades two cosine ramps of the same length, whose sum never
 * rises above the louder of the two — so the only headroom a voice needs is against the
 * normalized waveform's own peak of 1. Reserving room for a chord this player cannot sound
 * only bought a tuner too quiet to hear over the instrument.
 */
const VOICE_GAIN = 0.9;

/**
 * Master gain for a fader at `position` (0…1). Loudness follows decibels rather than
 * amplitude, so a fader taken straight as a gain does almost nothing across its top half
 * and everything in the last inch; squaring it spreads the useful range over the whole
 * travel — half way is a little over 12 dB down — while leaving full travel at full output.
 */
export const faderGain = (position: number) => position * position;

/**
 * The pluck envelope, as it sounds at `refHz`. A plucked string decays exponentially, but
 * not at one rate: the energy that goes into the pick attack dies away in a moment, and
 * what's left rings on for seconds. Two `setTargetAtTime` stages give that shape — a quick
 * drop, then a long tail — where a single ramp to silence only ever sounds like a blip.
 */
const PLUCK = {
  /** The pitch these times describe: an open G, around the middle of a guitar's range. */
  refHz: 196,
  /** Total ring, after which the note is quiet enough to stop. */
  length: 8,
  /** Time constant of the initial drop, and how long it lasts. */
  earlyTau: 0.7,
  knee: 0.4,
  /** Time constant of the tail: ~7 seconds to fall 36 dB below the attack. */
  tailTau: 2,
  /** Final fade to true silence, so stopping the oscillator can't click. Not part of the
   * shape, so unlike the times above it doesn't scale with pitch. */
  fade: 0.08,
};

/**
 * How sharply the envelope tightens as the pitch rises: every octave up multiplies every
 * time in it by `2 ** -PITCH_EXP`, about 0.59 here. Damping in a real string climbs steeply
 * with frequency — a top E is gone while a bottom E is still going — and a single envelope
 * slow enough to suit the low strings is what made every high note sound soft, a swell
 * rather than a pluck.
 */
const PITCH_EXP = 0.75;
/**
 * Bounds on that scaling, so neither end of the range ends up curt or interminable. They
 * aren't symmetric: the low strings were already about right, so they are barely stretched,
 * and all the room is left for tightening the top.
 */
const SCALE_MIN = 0.25;
const SCALE_MAX = 1.2;

export interface Envelope {
  attack: number;
  /** Seconds of ring after the attack, for a pluck. */
  length: number;
  earlyTau: number;
  knee: number;
  tailTau: number;
}

/** The envelope a note at `freq` gets; the pluck fields go unused by a drone. */
export function envelopeFor(freq: number): Envelope {
  const k = Math.min(SCALE_MAX, Math.max(SCALE_MIN, (PLUCK.refHz / freq) ** PITCH_EXP));
  return {
    // The attack tightens along with the rest: a percussive edge is as much of what makes a
    // pluck read as a pluck as the decay is.
    attack: Math.max(ATTACK_MIN, ATTACK * k),
    length: PLUCK.length * k,
    earlyTau: PLUCK.earlyTau * k,
    knee: PLUCK.knee * k,
    tailTau: PLUCK.tailTau * k,
  };
}

/** Level of the pluck envelope `secs` after the attack ends (where it is at 1). */
const pluckLevel = (env: Envelope, secs: number) =>
  secs <= env.knee ? Math.exp(-secs / env.earlyTau) : Math.exp(-env.knee / env.earlyTau) * Math.exp(-(secs - env.knee) / env.tailTau);

interface Voice {
  osc: OscillatorNode;
  gain: GainNode;
  freq: number;
  mode: PlayMode;
  env: Envelope;
  /** When the envelope starts, so a fade-out can pick it up exactly where it is. */
  startedAt: number;
  /** Set for plucked notes, which stop on their own. */
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * The envelope's value at absolute time `t`. Computed rather than read back from the
 * AudioParam: a main-thread `.value` is a quantum stale, and a fade that starts from a
 * stale value leaves the same step behind that LOOKAHEAD exists to avoid.
 */
function levelAt(v: Voice, t: number): number {
  const since = t - v.startedAt;
  if (since <= 0) return 0;
  if (since < v.env.attack) return VOICE_GAIN * (since / v.env.attack);
  if (v.mode === 'drone') return VOICE_GAIN;
  const rung = since - v.env.attack;
  return rung >= v.env.length ? 0 : VOICE_GAIN * pluckLevel(v.env, rung);
}

export class TonePlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private waves = new Map<Timbre, PeriodicWave>();
  private voices = new Map<string, Voice>();
  /** Fader position, not gain: `faderGain` maps one to the other. */
  private volume = 0.5;
  /** Called when a voice ends on its own, so the UI can drop its highlight. */
  onEnded: ((id: string) => void) | null = null;

  /** Created on the first note: a page load is not a user gesture, a click is. */
  private context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = faderGain(this.volume);
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private wave(ctx: AudioContext, timbre: Timbre): PeriodicWave {
    let w = this.waves.get(timbre);
    if (!w) {
      const amps = HARMONICS[timbre];
      const real = new Float32Array(amps.length + 1);
      const imag = new Float32Array(amps.length + 1);
      // imag[n] is the amplitude of the nth harmonic; imag[0] (DC) stays zero.
      for (let i = 0; i < amps.length; i++) imag[i + 1] = amps[i];
      w = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
      this.waves.set(timbre, w);
    }
    return w;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(faderGain(v), this.ctx.currentTime, 0.02);
  }

  isPlaying(id: string) {
    return this.voices.has(id);
  }

  /**
   * Starts the voice `id`, silencing every other one: the tuner sounds a single note at a
   * time, so a new pick cuts whatever is still ringing. Returns how long the note will
   * sound for — `Infinity` for a drone, which sounds until it is stopped.
   */
  play(id: string, freq: number, opts: { timbre: Timbre; mode: PlayMode }): number {
    const ctx = this.context();
    const t = ctx.currentTime + LOOKAHEAD;
    const env = envelopeFor(freq);
    // Anything still ringing fades out across the new note's attack — same instant and same
    // length, so the two cross over cleanly and their sum can't bulge in the middle.
    // (Snapshot the keys: release() deletes as it goes.)
    for (const other of [...this.voices.keys()]) this.release(other, env.attack, t);
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(this.wave(ctx, opts.timbre));
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.setValueCurveAtTime(cosineRamp(0, VOICE_GAIN), t, env.attack);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    const total = env.attack + env.length;
    if (opts.mode === 'pluck') {
      const peak = t + env.attack;
      gain.gain.setTargetAtTime(0, peak, env.earlyTau);
      // Takes over from whatever the first stage has reached, and rings on from there.
      gain.gain.setTargetAtTime(0, peak + env.knee, env.tailTau);
      // setTargetAtTime only approaches zero, so hand the tail's own value to a short fade —
      // starting it from the curve's exact level keeps the handover inaudible.
      const endsAt = peak + env.length;
      gain.gain.setValueCurveAtTime(cosineRamp(VOICE_GAIN * pluckLevel(env, env.length - PLUCK.fade), 0), endsAt - PLUCK.fade, PLUCK.fade);
      // `stop` has to come after `start`, or it throws.
      osc.stop(endsAt + 0.02);
    }

    const voice: Voice = { osc, gain, freq, mode: opts.mode, env, startedAt: t, timer: null };
    if (opts.mode === 'pluck') {
      voice.timer = setTimeout(() => {
        if (this.voices.get(id) === voice) {
          this.voices.delete(id);
          this.onEnded?.(id);
        }
      }, total * 1000);
    }
    this.voices.set(id, voice);
    return opts.mode === 'pluck' ? total : Number.POSITIVE_INFINITY;
  }

  /** Slides a sounding voice to a new pitch — used when A4, the octave or a string is changed mid-drone. */
  retune(id: string, freq: number) {
    const v = this.voices.get(id);
    if (!v || v.freq === freq) return;
    v.freq = freq;
    v.osc.frequency.setTargetAtTime(freq, this.ctx!.currentTime + LOOKAHEAD, 0.01);
  }

  /** Swaps the waveform under every sounding voice, without retriggering them. */
  setTimbre(timbre: Timbre) {
    if (!this.ctx) return;
    const wave = this.wave(this.ctx, timbre);
    for (const v of this.voices.values()) v.osc.setPeriodicWave(wave);
  }

  /**
   * Fades a voice out over `fade` seconds and stops it. `at` lets a swap line the fade up
   * with the new note's attack, so the two cross over at the same instant.
   */
  private release(id: string, fade: number, at?: number) {
    const v = this.voices.get(id);
    if (!v) return;
    this.voices.delete(id);
    if (v.timer !== null) clearTimeout(v.timer);
    const t = at ?? this.ctx!.currentTime + LOOKAHEAD;
    const g = v.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueCurveAtTime(cosineRamp(levelAt(v, t), 0), t, fade);
    v.osc.stop(t + fade + 0.01);
  }

  stop(id: string) {
    this.release(id, RELEASE);
  }

  stopAll() {
    for (const id of [...this.voices.keys()]) this.stop(id);
  }

  /** Releases the AudioContext; the next note builds a fresh one. */
  dispose() {
    this.stopAll();
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.waves.clear();
  }
}
