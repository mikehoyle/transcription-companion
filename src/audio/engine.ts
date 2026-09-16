import SignalsmithStretch, { type StretchNode } from 'signalsmith-stretch';
import { createChain, type ProcessingChain } from './chain';
import { store, type AppState } from '../store';

/** One entry of the playback time map (mirrors the stretch node's own map). */
interface Segment {
  output: number; // AudioContext time
  input: number; // position in the file (s)
  rate: number;
  semitones: number;
  formant: boolean;
  active: boolean;
}

const TICK_MS = 25;
const LOOKAHEAD = 0.2; // seconds of context time scheduled ahead
/** "Immediate" changes are stamped slightly in the past so a following schedule() can't pop them. */
const PAST = 0.003;

/**
 * Real-time playback: Signalsmith Stretch (pitch-preserving time stretch and
 * pitch shift) → processing chain → analyser → speakers, plus a metronome /
 * count-in click generator. Loop repeats, gaps, count-ins and the speed
 * trainer are scheduled against AudioContext time.
 *
 * Note on the stretch node's scheduler: every schedule() call drops all
 * changes timed at or after the node's current time, so at most ONE future
 * change can be pending. Events that need two (stop, then resume after a gap)
 * queue the second in `pendingResume` and send it once the first has passed.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private stretch: StretchNode | null = null;
  chain: ProcessingChain | null = null;
  analyser: AnalyserNode | null = null;
  private clickGain: GainNode | null = null;
  buffer: AudioBuffer | null = null;

  private segs: Segment[] = [{ output: 0, input: 0, rate: 1, semitones: 0, formant: false, active: false }];
  private lead = 0.05;
  private timer: number | null = null;
  /** Context time until which loop-boundary / end-of-file events are already scheduled. */
  private boundaryUntil = 0;
  private pendingResume: { after: number; seg: Partial<Segment> & { output: number } } | null = null;
  private clickCursor = -Infinity; // file position up to which clicks are scheduled
  private clickCursorReset: { at: number; pos: number } | null = null;
  private initPromise: Promise<void> | null = null;

  get playing() {
    return store.get().playing;
  }

  get duration() {
    return this.buffer?.duration ?? 0;
  }

  /** Input position last reported by the stretch worklet itself (debugging aid). */
  get nodeInputTime() {
    return this.stretch?.inputTime ?? 0;
  }

  async init(): Promise<AudioContext> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const ctx = new AudioContext({ latencyHint: 'interactive' });
        this.ctx = ctx;
        // The worklet expects one (unused) input even in buffer-playback mode.
        const stretch = await SignalsmithStretch(ctx, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        this.stretch = stretch;
        await stretch.setUpdateInterval(0.05);
        const latency = await stretch.latency();
        this.lead = Math.min(Math.max(latency, 0.03), 0.15);
        this.chain = createChain(ctx);
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 4096;
        this.analyser.smoothingTimeConstant = 0.6;
        stretch.connect(this.chain.input);
        this.chain.output.connect(this.analyser).connect(ctx.destination);
        this.clickGain = ctx.createGain();
        this.clickGain.connect(ctx.destination);
        this.chain.apply(store.get(), true);
      })();
    }
    await this.initPromise;
    return this.ctx!;
  }

  async load(buffer: AudioBuffer) {
    await this.init();
    this.pause();
    const stretch = this.stretch!;
    await stretch.dropBuffers();
    // Hand the whole file over as ONE buffer per channel. signalsmith-stretch 1.3.x
    // doesn't read correctly across multiple addBuffers() chunks, which left any
    // file longer than one chunk silent. Transferring (not cloning) keeps this cheap.
    const channels: Float32Array[] = [];
    for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) channels.push(buffer.getChannelData(c).slice());
    if (channels.length === 1) channels.push(channels[0].slice());
    await stretch.addBuffers(
      channels,
      channels.map((ch) => ch.buffer),
    );
    this.buffer = buffer;
    this.segs = [this.makeSeg({ output: this.ctx!.currentTime - PAST })];
    this.push({ active: false, input: 0, output: this.ctx!.currentTime });
  }

  // ---------------------------------------------------------------- time map

  private makeSeg(p: Partial<Segment>): Segment {
    const s = store.get();
    return {
      output: 0,
      input: 0,
      rate: s.rate,
      semitones: s.semitones + s.cents / 100,
      formant: s.formant,
      active: false,
      ...p,
    };
  }

  private segAt(t: number): Segment {
    let seg = this.segs[0];
    for (const s of this.segs) {
      if (s.output <= t) seg = s;
      else break;
    }
    return seg;
  }

  private inputAt(t: number): number {
    const seg = this.segAt(t);
    const pos = seg.active ? seg.input + Math.max(0, t - seg.output) * seg.rate : seg.input;
    return Math.min(Math.max(pos, 0), this.duration);
  }

  /**
   * Schedule a change at `output` (default now + lead). Mirrors the worklet's
   * semantics exactly: anything scheduled at or after "now" is replaced.
   */
  private push(change: Partial<Segment>) {
    if (!this.stretch || !this.ctx) return;
    const now = this.ctx.currentTime;
    let output = change.output ?? now + this.lead;
    if (output <= now) output = now - PAST;
    let latest = this.segs[this.segs.length - 1];
    while (this.segs.length && this.segs[this.segs.length - 1].output >= now) latest = this.segs.pop()!;
    const input = change.input ?? (latest.active ? latest.input + (output - latest.output) * latest.rate : latest.input);
    const seg: Segment = { ...latest, ...change, output, input };
    this.segs.push(seg);
    this.segs.sort((a, b) => a.output - b.output);
    while (this.segs.length > 1 && this.segs[1].output <= now) this.segs.shift();
    void this.stretch.schedule({
      output,
      input: seg.input,
      active: seg.active,
      rate: seg.rate,
      semitones: seg.semitones,
      formantCompensation: seg.formant,
      formantBaseHz: 0,
      loopStart: 0,
      loopEnd: 0,
    });
  }

  /** Current (audible) playback position in the file, in seconds. */
  getPosition(): number {
    if (!this.ctx) return this.segs[this.segs.length - 1].input;
    const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    return this.inputAt(this.ctx.currentTime - latency);
  }

  /** Whether audio is actually sounding right now (false during loop gaps / count-ins). */
  isSounding(): boolean {
    if (!this.ctx) return false;
    return this.segAt(this.ctx.currentTime).active;
  }

  // --------------------------------------------------------------- transport

  async play(from?: number) {
    if (!this.buffer) return;
    const ctx = await this.init();
    if (ctx.state !== 'running') await ctx.resume();
    const s = store.get();
    let pos = from ?? this.inputAt(ctx.currentTime);
    if (pos >= this.duration - 0.05) pos = s.loop.enabled ? s.loop.start : 0;
    if (s.loop.enabled && s.loop.end > s.loop.start && from === undefined && (pos < s.loop.start || pos >= s.loop.end)) {
      pos = s.loop.start;
    }
    this.pendingResume = null;
    const params = this.paramsFrom(s);
    if (s.countIn.onPlay) {
      this.push({ output: ctx.currentTime, input: pos, active: false, ...params });
      const startAt = this.scheduleCountIn(ctx.currentTime + this.lead);
      this.push({ output: startAt, input: pos, active: true, ...params });
    } else {
      this.push({ output: ctx.currentTime + this.lead, input: pos, active: true, ...params });
    }
    this.boundaryUntil = 0;
    this.clickCursor = pos - 1e-3;
    this.clickCursorReset = null;
    store.set({ playing: true, playStart: pos });
    this.startTimer();
  }

  pause() {
    this.pendingResume = null;
    if (!this.ctx || !this.stretch) {
      store.set({ playing: false });
      return;
    }
    const pos = this.getPosition();
    this.push({ output: this.ctx.currentTime, input: pos, active: false });
    this.stopTimer();
    this.resetClicks();
    store.set({ playing: false });
  }

  toggle() {
    if (this.playing) this.pause();
    else void this.play();
  }

  seek(t: number) {
    const pos = Math.min(Math.max(0, t), this.duration);
    if (!this.ctx) {
      this.segs = [this.makeSeg({ input: pos })];
      return;
    }
    this.pendingResume = null;
    if (this.playing) {
      this.resetClicks();
      this.push({ output: this.ctx.currentTime, input: pos, active: true, ...this.paramsFrom(store.get()) });
      this.boundaryUntil = 0;
      this.clickCursor = pos - 1e-3;
    } else {
      this.push({ output: this.ctx.currentTime, input: pos, active: false });
    }
  }

  /** Re-apply speed / pitch / formant from the store. */
  updateParams() {
    if (!this.ctx) return;
    const p = this.paramsFrom(store.get());
    if (this.pendingResume) Object.assign(this.pendingResume.seg, p);
    const now = this.ctx.currentTime;
    const last = this.segs[this.segs.length - 1];
    if (last.rate === p.rate && last.semitones === p.semitones && last.formant === p.formant) return;
    const future = this.segs.find((s) => s.output > now);
    this.push({ output: now, ...p });
    if (future) this.push({ ...future, ...p });
    if (this.playing) {
      this.resetClicks();
      this.clickCursor = this.inputAt(now) - 1e-3;
      if (!future) this.boundaryUntil = Math.min(this.boundaryUntil, now);
    }
  }

  /** Loop settings changed: throw away scheduled loop events and resume normally. */
  loopChanged() {
    if (!this.ctx || !this.playing) return;
    const now = this.ctx.currentTime;
    if (this.pendingResume || this.segs.some((s) => s.output > now) || this.boundaryUntil > now) {
      const s = store.get();
      const pos = this.inputAt(now);
      const inLoop = s.loop.enabled && pos >= s.loop.start && pos < s.loop.end;
      this.pendingResume = null;
      this.push({ output: now, input: inLoop || !s.loop.enabled ? pos : s.loop.start, active: true, ...this.paramsFrom(s) });
      this.resetClicks();
    }
    this.boundaryUntil = 0;
  }

  private paramsFrom(s: AppState) {
    return { rate: s.rate, semitones: s.semitones + s.cents / 100, formant: s.formant };
  }

  // ------------------------------------------------------------ scheduling

  private startTimer() {
    if (this.timer === null) this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  private stopTimer() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick() {
    const ctx = this.ctx;
    if (!ctx || !this.playing) return;
    const now = ctx.currentTime;
    const s = store.get();
    const horizon = now + LOOKAHEAD;

    // second half of a stop → resume pair, now that the stop has taken effect
    if (this.pendingResume && now > this.pendingResume.after) {
      const { seg } = this.pendingResume;
      this.pendingResume = null;
      this.push({ ...seg, output: Math.max(seg.output, now + 0.01) });
    }

    if (this.boundaryUntil <= now && !this.pendingResume) {
      const seg = this.segAt(now);
      const last = this.segs[this.segs.length - 1];
      if (seg === last && seg.active) {
        const pos = this.inputAt(now);
        const loopOn = s.loop.enabled && s.loop.end - s.loop.start > 0.02 && pos < s.loop.end;
        const endPos = loopOn ? s.loop.end : this.duration;
        const tEnd = now + (endPos - pos) / seg.rate;
        if (tEnd <= horizon) {
          if (loopOn) this.scheduleLoopRestart(Math.max(tEnd, now + 0.005), s);
          else this.scheduleEndOfFile(Math.max(tEnd, now + 0.005));
        }
      } else if (!last.active && last.output <= now) {
        // reached the end and stopped
        this.stopTimer();
        store.set({ playing: false });
        return;
      }
    }

    if (s.metronome.on) this.scheduleMetronome(now, horizon, s);
  }

  private scheduleLoopRestart(tEnd: number, s: AppState) {
    let rate = s.rate;
    const trainer = s.trainer;
    if (trainer.enabled) {
      let rep = trainer.rep + 1;
      if (rep >= trainer.repsPerStep) {
        rep = 0;
        const dir = trainer.targetRate >= rate ? 1 : -1;
        const next = rate + dir * trainer.step;
        rate = dir > 0 ? Math.min(trainer.targetRate, next) : Math.max(trainer.targetRate, next);
        rate = Math.round(rate * 1000) / 1000;
      }
      // update the store after scheduling, so updateParams sees matching values
      queueMicrotask(() => store.set((st) => ({ rate, trainer: { ...st.trainer, rep } })));
    }
    const params = { rate, semitones: s.semitones + s.cents / 100, formant: s.formant };
    const gap = s.loopGap >= 0.05 ? s.loopGap : 0;
    if (gap > 0 || s.countIn.onLoop) {
      this.push({ output: tEnd, input: s.loop.start, active: false, ...params });
      let resume = tEnd + gap;
      if (s.countIn.onLoop) resume = this.scheduleCountIn(resume, rate);
      this.pendingResume = { after: tEnd, seg: { output: resume, input: s.loop.start, active: true, ...params } };
      this.boundaryUntil = resume;
    } else {
      this.push({ output: tEnd, input: s.loop.start, active: true, ...params });
      this.boundaryUntil = tEnd;
    }
    this.clickCursorReset = { at: tEnd, pos: s.loop.start - 1e-3 };
  }

  private scheduleEndOfFile(tEnd: number) {
    this.push({ output: tEnd, input: this.duration, active: false });
    this.boundaryUntil = tEnd + 0.01;
  }

  /** Schedules count-in clicks ending at `startAt`; returns the (possibly later) start time. */
  private scheduleCountIn(startAt: number, rate = store.get().rate): number {
    const s = store.get();
    const beats = Math.max(1, s.countIn.bars) * s.tempo.beatsPerBar;
    const beatSec = 60 / s.tempo.bpm / rate;
    const first = Math.max(startAt, (this.ctx?.currentTime ?? 0) + 0.05);
    for (let i = 0; i < beats; i++) this.click(first + i * beatSec, i % s.tempo.beatsPerBar === 0, 1);
    return first + beats * beatSec;
  }

  private scheduleMetronome(now: number, horizon: number, s: AppState) {
    if (this.clickCursorReset && now >= this.clickCursorReset.at) {
      this.clickCursor = this.clickCursorReset.pos;
      this.clickCursorReset = null;
    }
    const seg = this.segAt(now);
    if (!seg.active) return;
    // don't schedule across the next time-map change
    const next = this.segs.find((x) => x.output > now);
    const until = Math.min(horizon, next ? next.output : Infinity);
    const posNow = this.inputAt(now);
    const posUntil = seg.input + (until - seg.output) * seg.rate;
    if (this.clickCursor < posNow - 0.5) this.clickCursor = posNow - 1e-3;
    const beat = 60 / s.tempo.bpm;
    const bpb = s.tempo.beatsPerBar;
    const k0 = Math.ceil((Math.max(this.clickCursor, posNow - 0.01) - s.tempo.offset) / beat);
    for (let k = k0; ; k++) {
      const bt = s.tempo.offset + k * beat;
      if (bt > posUntil || bt > this.duration) break;
      if (bt <= this.clickCursor || bt < 0) continue;
      const t = now + (bt - posNow) / seg.rate;
      if (t >= now - 0.005) this.click(Math.max(t, now), ((k % bpb) + bpb) % bpb === 0, s.metronome.volume);
      this.clickCursor = bt;
    }
    this.clickCursor = Math.max(this.clickCursor, posUntil);
  }

  private resetClicks() {
    this.clickCursorReset = null;
    this.clickCursor = -Infinity;
  }

  private click(when: number, accent: boolean, volume: number) {
    const ctx = this.ctx;
    if (!ctx || !this.clickGain) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = accent ? 1760 : 1175;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.5 * volume, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.06);
    osc.connect(g).connect(this.clickGain);
    osc.start(when);
    osc.stop(when + 0.08);
  }

  /** Short click used by the tap-tempo UI. */
  tapClick() {
    if (this.ctx) this.click(this.ctx.currentTime, false, 0.4);
  }
}

export const engine = new AudioEngine();
