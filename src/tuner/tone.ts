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

const ATTACK = 0.015;
/** Fade when a note is deliberately stopped. */
const RELEASE = 0.08;
/**
 * Fade when a new note replaces one that is still ringing: fast enough that the swap feels
 * instant, long enough that it doesn't click.
 */
const CUT = 0.015;
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
/** Headroom so a six-string strum doesn't clip. */
const VOICE_GAIN = 0.22;

/**
 * A plucked string decays exponentially, but not at one rate: the energy that goes into the
 * pick attack dies away in a moment, and what's left rings on for seconds. Two `setTargetAtTime`
 * stages give that shape — a quick drop, then a long tail — where a single ramp to silence
 * only ever sounds like a blip.
 */
const PLUCK = {
  /** Total ring, after which the note is quiet enough to stop. */
  length: 8,
  /** Time constant of the initial drop, and how long it lasts. */
  earlyTau: 0.7,
  knee: 0.4,
  /** Time constant of the tail: ~7 seconds to fall 36 dB below the attack. */
  tailTau: 2,
  /** Final fade to true silence, so stopping the oscillator can't click. */
  fade: 0.08,
};

/** Level of the pluck envelope `secs` after the note starts (the attack is at 1). */
const pluckLevel = (secs: number) =>
  secs <= PLUCK.knee ? Math.exp(-secs / PLUCK.earlyTau) : Math.exp(-PLUCK.knee / PLUCK.earlyTau) * Math.exp(-(secs - PLUCK.knee) / PLUCK.tailTau);

interface Voice {
  osc: OscillatorNode;
  gain: GainNode;
  freq: number;
  mode: PlayMode;
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
  if (since < ATTACK) return VOICE_GAIN * (since / ATTACK);
  if (v.mode === 'drone') return VOICE_GAIN;
  const rung = since - ATTACK;
  return rung >= PLUCK.length ? 0 : VOICE_GAIN * pluckLevel(rung);
}

export class TonePlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private waves = new Map<Timbre, PeriodicWave>();
  private voices = new Map<string, Voice>();
  private volume = 0.5;
  /** Called when a voice ends on its own, so the UI can drop its highlight. */
  onEnded: ((id: string) => void) | null = null;

  /** Created on the first note: a page load is not a user gesture, a click is. */
  private context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
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
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  isPlaying(id: string) {
    return this.voices.has(id);
  }

  /**
   * Starts the voice `id`, silencing every other one: the tuner sounds a single note at a
   * time, so a new pick cuts whatever is still ringing.
   */
  play(id: string, freq: number, opts: { timbre: Timbre; mode: PlayMode }) {
    const ctx = this.context();
    const t = ctx.currentTime + LOOKAHEAD;
    // Anything still ringing fades out across the new note's attack — same instant, so the
    // two cross over cleanly. (Snapshot the keys: release() deletes as it goes.)
    for (const other of [...this.voices.keys()]) this.release(other, CUT, t);
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(this.wave(ctx, opts.timbre));
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.setValueCurveAtTime(cosineRamp(0, VOICE_GAIN), t, ATTACK);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    if (opts.mode === 'pluck') {
      const peak = t + ATTACK;
      gain.gain.setTargetAtTime(0, peak, PLUCK.earlyTau);
      // Takes over from whatever the first stage has reached, and rings on from there.
      gain.gain.setTargetAtTime(0, peak + PLUCK.knee, PLUCK.tailTau);
      // setTargetAtTime only approaches zero, so hand the tail's own value to a short fade —
      // starting it from the curve's exact level keeps the handover inaudible.
      const endsAt = peak + PLUCK.length;
      gain.gain.setValueCurveAtTime(cosineRamp(VOICE_GAIN * pluckLevel(PLUCK.length - PLUCK.fade), 0), endsAt - PLUCK.fade, PLUCK.fade);
      // `stop` has to come after `start`, or it throws.
      osc.stop(endsAt + 0.02);
    }

    const voice: Voice = { osc, gain, freq, mode: opts.mode, startedAt: t, timer: null };
    if (opts.mode === 'pluck') {
      const ms = (ATTACK + PLUCK.length) * 1000;
      voice.timer = setTimeout(() => {
        if (this.voices.get(id) === voice) {
          this.voices.delete(id);
          this.onEnded?.(id);
        }
      }, ms);
    }
    this.voices.set(id, voice);
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
