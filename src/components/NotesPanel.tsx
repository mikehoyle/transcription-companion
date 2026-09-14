import { useRef, useState } from 'react';
import { engine } from '../audio/engine';
import {
  NOTE_COUNT,
  NOTE_MIN,
  chroma,
  formatChord,
  guessChord,
  guessNotes,
  midiToFreq,
  noteName,
  pcName,
  spectrumAt,
  toDisplayLevels,
} from '../audio/music';
import { getAnalysisSignal } from '../controller';
import { store, useStore } from '../store';
import { Panel, fitCanvas, useAnimationFrame } from './controls';

export const TRANSPOSITIONS = [
  { value: 0, label: 'Concert pitch (C)' },
  { value: 2, label: 'B♭ instrument (trumpet, clarinet, tenor sax)' },
  { value: 9, label: 'E♭ instrument (alto / bari sax)' },
  { value: 7, label: 'F instrument (horn)' },
  { value: 12, label: 'Guitar / bass (written 8va)' },
];

const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);

export function NotesPanel() {
  const transposeDisplay = useStore((s) => s.transposeDisplay);
  const key = useStore((s) => s.analysis.key);
  const semitones = useStore((s) => s.semitones);
  const cents = useStore((s) => s.cents);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chordRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLDivElement>(null);
  const state = useRef({ lastPos: -1, lastTime: 0, spec: null as Float32Array | null, ref: 1e-3, notes: [] as number[] });
  const [sensitivity, setSensitivity] = useState(-18);

  const shift = Math.round(semitones + cents / 100);

  useAnimationFrame(() => {
    const canvas = canvasRef.current;
    const signal = getAnalysisSignal();
    const st = state.current;
    const s = store.get();
    const now = performance.now();
    const pos = engine.getPosition();
    const totalShift = Math.round(s.semitones + s.cents / 100) + s.transposeDisplay;

    if (signal && (Math.abs(pos - st.lastPos) > 0.005 || !st.spec) && now - st.lastTime > 50) {
      st.lastTime = now;
      st.lastPos = pos;
      const spec = spectrumAt(signal, pos);
      let max = 0;
      for (const v of spec) max = Math.max(max, v);
      // slow-decaying reference level so quiet passages still show relative detail
      st.ref = Math.max(max, st.ref * 0.97, 1e-4);
      st.spec = spec;
      st.notes = guessNotes(spec, 6, sensitivityRef.current);
      const ch = chroma(spec);
      const bass = st.notes.length ? st.notes[0] % 12 : undefined;
      const chord = guessChord(ch, bass);
      if (chordRef.current) chordRef.current.textContent = chord ? formatChord(chord, totalShift) : max < 1e-3 ? '—' : '?';
      if (notesRef.current) notesRef.current.textContent = st.notes.map((n) => noteName(n + totalShift)).join('  ') || ' ';
    }

    if (!canvas) return;
    const [w, h, dpr] = fitCanvas(canvas);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const keyH = Math.min(70, h * 0.45);
    const barTop = 6;
    const barBottom = h - keyH - 4;

    // display notes: original note + shift
    const dispMin = NOTE_MIN;
    const dispMax = NOTE_MIN + NOTE_COUNT - 1;
    const whites: number[] = [];
    for (let m = dispMin; m <= dispMax; m++) if (!isBlack(m)) whites.push(m);
    const ww = w / whites.length;
    const xOf = (m: number) => {
      const wi = whites.findIndex((x) => x >= m);
      if (!isBlack(m)) return { x: wi * ww, w: ww };
      return { x: wi * ww - ww * 0.32, w: ww * 0.64 };
    };
    keyLayout.current = { ww, whites, keyTop: h - keyH, h };

    const levels = st.spec ? toDisplayLevels(st.spec, st.ref, 50) : null;
    const guessed = new Set(st.notes.map((n) => n + totalShift - s.transposeDisplay));

    // grid lines at C
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let m = dispMin; m <= dispMax; m++) if (m % 12 === 0) ctx.fillRect(xOf(m).x, barTop, 1, barBottom - barTop);

    if (levels) {
      for (let i = 0; i < NOTE_COUNT; i++) {
        const disp = NOTE_MIN + i + (totalShift - s.transposeDisplay);
        if (disp < dispMin || disp > dispMax) continue;
        const { x, w: kw } = xOf(disp);
        const bh = levels[i] * (barBottom - barTop);
        ctx.fillStyle = guessed.has(disp) ? '#f5a524' : isBlack(disp) ? '#4c6fb8' : '#5b8def';
        ctx.fillRect(x + kw * 0.15, barBottom - bh, kw * 0.7, bh);
      }
    }

    // keyboard
    const keyTop = h - keyH;
    for (let i = 0; i < whites.length; i++) {
      const m = whites[i];
      const on = guessed.has(m);
      ctx.fillStyle = on ? '#f5a524' : '#e9ebf0';
      ctx.fillRect(i * ww + 0.5, keyTop, ww - 1, keyH);
      if (m % 12 === 0) {
        ctx.fillStyle = '#5a6070';
        ctx.font = `${Math.min(10, ww * 0.8)}px system-ui, sans-serif`;
        ctx.fillText(noteName(m + s.transposeDisplay), i * ww + 2, h - 4);
      }
    }
    for (let m = dispMin; m <= dispMax; m++) {
      if (!isBlack(m)) continue;
      const { x, w: kw } = xOf(m);
      ctx.fillStyle = guessed.has(m) ? '#d4860a' : '#1c1f26';
      ctx.fillRect(x, keyTop, kw, keyH * 0.6);
    }
  });

  const sensitivityRef = useRef(sensitivity);
  sensitivityRef.current = sensitivity;
  const keyLayout = useRef<{ ww: number; whites: number[]; keyTop: number; h: number } | null>(null);

  const playNote = async (e: React.PointerEvent<HTMLCanvasElement>) => {
    const layout = keyLayout.current;
    if (!layout) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (y < layout.keyTop) return;
    const wi = Math.floor(x / layout.ww);
    let midi = layout.whites[Math.max(0, Math.min(layout.whites.length - 1, wi))];
    if (y < layout.keyTop + (layout.h - layout.keyTop) * 0.6) {
      const frac = x / layout.ww - wi;
      if (frac < 0.32 && isBlack(midi - 1)) midi -= 1;
      else if (frac > 0.68 && isBlack(midi + 1)) midi += 1;
    }
    const ctx = await engine.init();
    if (ctx.state !== 'running') await ctx.resume();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc2.type = 'sine';
    // display note is concert pitch + transposeDisplay; sound concert pitch
    osc.frequency.value = midiToFreq(midi);
    osc2.frequency.value = midiToFreq(midi) * 2;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.25, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    const g2 = ctx.createGain();
    g2.gain.value = 0.15;
    osc.connect(g);
    osc2.connect(g2).connect(g);
    g.connect(ctx.destination);
    osc.start(t);
    osc2.start(t);
    osc.stop(t + 1.3);
    osc2.stop(t + 1.3);
  };

  const keyName = key ? `${pcName(key.tonic + shift + transposeDisplay)} ${key.mode}` : '…';

  return (
    <Panel
      title="Notes & chords at playhead"
      className="notes-panel"
      actions={
        <>
          <label className="inline-field" title="Sensitivity of note guessing">
            Sensitivity
            <input type="range" min={-30} max={-8} value={sensitivity} onChange={(e) => setSensitivity(Number(e.target.value))} />
          </label>
          <select
            value={transposeDisplay}
            title="Display note names for a transposing instrument"
            onChange={(e) => store.set({ transposeDisplay: Number(e.target.value) })}
          >
            {TRANSPOSITIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </>
      }
    >
      <div className="notes-readout">
        <div className="readout-block">
          <span className="readout-label">Chord</span>
          <div ref={chordRef} className="chord-name">
            —
          </div>
        </div>
        <div className="readout-block grow">
          <span className="readout-label">Notes</span>
          <div ref={notesRef} className="note-list" />
        </div>
        <div className="readout-block">
          <span className="readout-label">Song key</span>
          <div className="key-name">{keyName}</div>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        className="spectrum-canvas"
        onPointerDown={playNote}
        title="Pitch spectrum at the playhead. Orange = guessed notes. Click a key to hear a reference tone."
      />
    </Panel>
  );
}
