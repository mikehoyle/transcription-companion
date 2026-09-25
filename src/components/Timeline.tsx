import { useEffect, useRef, type RefObject } from 'react';
import { engine } from '../audio/engine';
import { noteName } from '../audio/music';
import * as c from '../controller';
import { markerColor, store, useStore, type AppState } from '../store';
import { fmtTime } from '../util';
import { fitCanvas, useAnimationFrame } from './controls';

export const GUTTER = 44;
const RULER_H = 20;

const COL = {
  bg: '#101217',
  gutter: '#15181f',
  wave: '#5b8def',
  waveDim: '#2f4a80',
  rms: '#8fb3ff',
  ruler: '#8a90a0',
  tick: '#2a2f3a',
  playhead: '#ff5d5d',
  loop: 'rgba(245,165,36,0.16)',
  loopOff: 'rgba(160,160,160,0.10)',
  loopEdge: '#f5a524',
  loopEdgeOff: '#80776a',
  bar: 'rgba(255,255,255,0.20)',
  beat: 'rgba(255,255,255,0.07)',
  hover: 'rgba(255,255,255,0.35)',
};

const NICE_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];

interface Layer {
  key: string;
  canvas: HTMLCanvasElement;
}

function cachedLayer(ref: { current: Layer | null }, key: string, w: number, h: number, render: (ctx: CanvasRenderingContext2D) => void) {
  if (!ref.current) ref.current = { key: '', canvas: document.createElement('canvas') };
  const layer = ref.current;
  if (layer.key !== key) {
    layer.canvas.width = w;
    layer.canvas.height = h;
    const ctx = layer.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    render(ctx);
    layer.key = key;
  }
  return layer.canvas;
}

const mapping = (s: AppState, width: number) => {
  const span = Math.max(1e-6, s.view.end - s.view.start);
  const inner = width - GUTTER;
  return {
    x: (t: number) => GUTTER + ((t - s.view.start) / span) * inner,
    t: (x: number) => s.view.start + ((x - GUTTER) / inner) * span,
    pxPerSec: inner / span,
  };
};

const pitchShift = (s: AppState) => Math.round(s.semitones + s.cents / 100);

// ---------------------------------------------------------------- pointer

type Drag = { type: 'pending'; x0: number; t0: number } | { type: 'select'; t0: number } | { type: 'marker'; id: string; moved: boolean } | { type: 'loop-start' | 'loop-end' };

/** `mounted` must change whenever the canvas is conditionally rendered, so listeners get (re)attached. */
function useTimelinePointer(ref: RefObject<HTMLCanvasElement | null>, hover: { current: number | null }, markerZone: boolean, mounted = true) {
  // `mounted` is what reattaches the listeners when a conditionally rendered canvas
  // appears; the rule treats this custom hook's parameter as an outer-scope value.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let drag: Drag | null = null;

    const local = (e: PointerEvent | MouseEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width };
    };

    const hit = (x: number, y: number, w: number) => {
      const s = store.get();
      const m = mapping(s, w);
      if (markerZone && y < RULER_H + 18) {
        const mk = s.markers.find((mk) => Math.abs(m.x(mk.time) - x) < 6);
        if (mk) return { kind: 'marker' as const, id: mk.id };
      }
      if (s.loop.end - s.loop.start > 0.02) {
        if (Math.abs(m.x(s.loop.start) - x) < 6) return { kind: 'loop-start' as const };
        if (Math.abs(m.x(s.loop.end) - x) < 6) return { kind: 'loop-end' as const };
      }
      return null;
    };

    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const { x, y, w } = local(e);
      if (x < GUTTER || !store.get().file) return;
      const h = hit(x, y, w);
      const t = mapping(store.get(), w).t(x);
      if (h?.kind === 'marker') drag = { type: 'marker', id: h.id, moved: false };
      else if (h) drag = { type: h.kind };
      else drag = { type: 'pending', x0: x, t0: t };
      canvas.setPointerCapture(e.pointerId);
    };

    const move = (e: PointerEvent) => {
      const { x, y, w } = local(e);
      const s = store.get();
      const t = Math.max(0, Math.min(s.file?.duration ?? 0, mapping(s, w).t(x)));
      hover.current = x >= GUTTER ? t : null;
      if (!drag) {
        const h = x >= GUTTER ? hit(x, y, w) : null;
        canvas.style.cursor = h ? (h.kind === 'marker' ? 'grab' : 'ew-resize') : 'crosshair';
        return;
      }
      switch (drag.type) {
        case 'pending':
          if (Math.abs(x - drag.x0) > 4) drag = { type: 'select', t0: drag.t0 };
          break;
        case 'select':
          c.setLoop(c.snap(drag.t0), c.snap(t), true);
          break;
        case 'marker':
          drag.moved = true;
          c.moveMarker(drag.id, c.snap(t));
          break;
        case 'loop-start':
          c.setLoop(Math.min(c.snap(t), s.loop.end - 0.02), s.loop.end, s.loop.enabled);
          break;
        case 'loop-end':
          c.setLoop(s.loop.start, Math.max(c.snap(t), s.loop.start + 0.02), s.loop.enabled);
          break;
      }
    };

    const up = (e: PointerEvent) => {
      if (!drag) return;
      const { x, w } = local(e);
      const s = store.get();
      if (drag.type === 'pending') c.seek(mapping(s, w).t(x));
      else if (drag.type === 'marker' && !drag.moved) {
        const mk = s.markers.find((m) => m.id === (drag as { id: string }).id);
        if (mk) c.seek(mk.time);
      } else if (drag.type === 'select' && !s.playing) {
        engine.seek(s.loop.start);
        store.set({ playStart: s.loop.start });
      }
      drag = null;
    };

    const dbl = (e: MouseEvent) => {
      const { x, y, w } = local(e);
      const h = hit(x, y, w);
      if (h?.kind === 'marker') {
        const mk = store.get().markers.find((m) => m.id === h.id);
        const label = mk && window.prompt('Marker label', mk.label);
        if (mk && label !== null && label !== undefined) c.renameMarker(mk.id, label);
      }
    };

    const wheel = (e: WheelEvent) => {
      const s = store.get();
      if (!s.file) return;
      e.preventDefault();
      const { x, w } = local(e);
      if (e.ctrlKey || e.metaKey || e.altKey) {
        c.zoom(Math.exp(e.deltaY * 0.004), mapping(s, w).t(Math.max(GUTTER, x)));
      } else {
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        const span = s.view.end - s.view.start;
        c.setView(s.view.start + (delta / (w - GUTTER)) * span, s.view.end + (delta / (w - GUTTER)) * span);
      }
    };

    const leave = () => (hover.current = null);

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('dblclick', dbl);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('pointerleave', leave);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('dblclick', dbl);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('pointerleave', leave);
    };
  }, [ref, hover, markerZone, mounted]);
}

// ---------------------------------------------------------------- drawing

function drawWaveLayer(ctx: CanvasRenderingContext2D, s: AppState, w: number, top: number, h: number, dpr: number) {
  const peaks = c.getPeaks();
  const buffer = engine.buffer;
  if (!peaks || !buffer) return;
  const m = mapping(s, w);
  const mid = top + h / 2;
  const amp = (h / 2) * 0.95;
  const sr = buffer.sampleRate;
  const samplesPerPx = sr / m.pxPerSec / dpr;
  ctx.save();
  ctx.scale(dpr, dpr);
  if (samplesPerPx >= peaks.bucket) {
    ctx.fillStyle = COL.wave;
    const step = 1 / dpr;
    for (let px = GUTTER; px < w; px += step) {
      const t0 = m.t(px);
      const t1 = m.t(px + step);
      if (t1 < 0 || t0 > buffer.duration) continue;
      const b0 = Math.max(0, Math.floor((t0 * sr) / peaks.bucket));
      const b1 = Math.min(peaks.min.length, Math.max(b0 + 1, Math.ceil((t1 * sr) / peaks.bucket)));
      let lo = 0;
      let hi = 0;
      for (let b = b0; b < b1; b++) {
        if (peaks.min[b] < lo) lo = peaks.min[b];
        if (peaks.max[b] > hi) hi = peaks.max[b];
      }
      const y0 = mid - hi * amp;
      const y1 = mid - lo * amp;
      ctx.fillRect(px, y0, step, Math.max(step, y1 - y0));
    }
  } else {
    // zoomed in far enough to draw individual samples
    const chans = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, i) => buffer.getChannelData(i));
    const i0 = Math.max(0, Math.floor(m.t(GUTTER) * sr) - 1);
    const i1 = Math.min(buffer.length - 1, Math.ceil(m.t(w) * sr) + 1);
    ctx.strokeStyle = COL.wave;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) {
      let v = 0;
      for (const ch of chans) v += ch[i];
      v /= chans.length;
      const x = m.x(i / sr);
      const y = mid - v * amp;
      if (i === i0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    if (m.pxPerSec / sr > 6) {
      ctx.fillStyle = COL.rms;
      for (let i = i0; i <= i1; i++) {
        let v = 0;
        for (const ch of chans) v += ch[i];
        ctx.fillRect(m.x(i / sr) - 1.5, mid - (v / chans.length) * amp - 1.5, 3, 3);
      }
    }
  }
  ctx.strokeStyle = COL.tick;
  ctx.beginPath();
  ctx.moveTo(GUTTER, mid + 0.5);
  ctx.lineTo(w, mid + 0.5);
  ctx.stroke();
  ctx.restore();
}

function drawGrid(ctx: CanvasRenderingContext2D, s: AppState, w: number, top: number, bottom: number, labels: boolean) {
  const m = mapping(s, w);
  const beat = 60 / s.tempo.bpm;
  const bpb = s.tempo.beatsPerBar;
  const beatPx = beat * m.pxPerSec;
  if (beatPx * bpb < 4) return;
  const k0 = Math.floor((s.view.start - s.tempo.offset) / beat);
  const k1 = Math.ceil((s.view.end - s.tempo.offset) / beat);
  const barEvery = Math.max(1, 2 ** Math.ceil(Math.log2(28 / (beatPx * bpb))));
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
  for (let k = k0; k <= k1; k++) {
    const t = s.tempo.offset + k * beat;
    if (t < 0) continue;
    const isBar = ((k % bpb) + bpb) % bpb === 0;
    if (!isBar && beatPx < 8) continue;
    const x = Math.round(m.x(t)) + 0.5;
    if (x < GUTTER) continue;
    ctx.strokeStyle = isBar ? COL.bar : COL.beat;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    const bar = Math.floor(k / bpb) + 1;
    if (labels && isBar && (bar - 1) % barEvery === 0) {
      ctx.fillStyle = '#b9c0d0';
      ctx.fillText(String(bar), x + 3, top + 10);
    }
  }
}

function drawRuler(ctx: CanvasRenderingContext2D, s: AppState, w: number) {
  const m = mapping(s, w);
  ctx.fillStyle = COL.gutter;
  ctx.fillRect(0, 0, w, RULER_H);
  const step = NICE_STEPS.find((st) => st * m.pxPerSec >= 80) ?? 3600;
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = COL.ruler;
  ctx.strokeStyle = COL.tick;
  const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  for (let t = Math.floor(s.view.start / step) * step; t <= s.view.end; t += step) {
    const x = Math.round(m.x(t)) + 0.5;
    if (x < GUTTER) continue;
    ctx.beginPath();
    ctx.moveTo(x, RULER_H - 6);
    ctx.lineTo(x, RULER_H);
    ctx.stroke();
    if (!s.gridVisible) ctx.fillText(fmtTime(t, decimals), x + 3, 12);
  }
}

function drawLoop(ctx: CanvasRenderingContext2D, s: AppState, w: number, top: number, bottom: number) {
  if (s.loop.end - s.loop.start <= 0.02) return;
  const m = mapping(s, w);
  const x0 = Math.max(GUTTER, m.x(s.loop.start));
  const x1 = Math.min(w, m.x(s.loop.end));
  if (x1 < GUTTER || x0 > w) return;
  ctx.fillStyle = s.loop.enabled ? COL.loop : COL.loopOff;
  ctx.fillRect(x0, top, x1 - x0, bottom - top);
  ctx.strokeStyle = s.loop.enabled ? COL.loopEdge : COL.loopEdgeOff;
  ctx.lineWidth = 2;
  for (const t of [s.loop.start, s.loop.end]) {
    const x = m.x(t);
    if (x < GUTTER || x > w) continue;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
  }
  ctx.lineWidth = 1;
}

function drawMarkers(ctx: CanvasRenderingContext2D, s: AppState, w: number, top: number, bottom: number, labels: boolean) {
  const m = mapping(s, w);
  ctx.font = '11px system-ui, sans-serif';
  s.markers.forEach((mk, i) => {
    const x = Math.round(m.x(mk.time)) + 0.5;
    if (x < GUTTER || x > w) return;
    const col = markerColor(mk);
    ctx.strokeStyle = col;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    if (labels) {
      const text = [i < 9 ? String(i + 1) : '', mk.label.trim()].filter(Boolean).join(' ');
      if (!text) return;
      const tw = ctx.measureText(text).width + 8;
      ctx.fillStyle = col;
      ctx.fillRect(x, RULER_H, tw, 15);
      ctx.fillStyle = '#0c0e12';
      ctx.fillText(text, x + 4, RULER_H + 11);
    }
  });
}

function drawPlayhead(ctx: CanvasRenderingContext2D, s: AppState, w: number, h: number, pos: number, hover: number | null) {
  const m = mapping(s, w);
  if (hover !== null) {
    const hx = Math.round(m.x(hover)) + 0.5;
    ctx.strokeStyle = COL.hover;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(hx, 0);
    ctx.lineTo(hx, h);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const x = m.x(pos);
  if (x >= GUTTER && x <= w) {
    ctx.strokeStyle = COL.playhead;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.lineWidth = 1;
  }
}

const ROLL_LUT = (() => {
  const lut = new Uint8ClampedArray(256 * 4);
  const stops = [
    [0, 16, 18, 23],
    [0.35, 40, 40, 90],
    [0.6, 170, 60, 90],
    [0.8, 245, 165, 36],
    [1, 255, 250, 220],
  ];
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    let j = 0;
    while (j < stops.length - 2 && v > stops[j + 1][0]) j++;
    const [a, b] = [stops[j], stops[j + 1]];
    const f = Math.min(1, Math.max(0, (v - a[0]) / (b[0] - a[0])));
    for (let k = 0; k < 3; k++) lut[i * 4 + k] = a[k + 1] + (b[k + 1] - a[k + 1]) * f;
    lut[i * 4 + 3] = 255;
  }
  return lut;
})();

function renderRollLayer(ctx: CanvasRenderingContext2D, s: AppState, w: number, h: number) {
  const roll = s.analysis.roll;
  if (!roll) return;
  const m = mapping(s, w);
  const cols = Math.max(1, Math.floor(w - GUTTER));
  const rows = roll.noteCount;
  const img = ctx.createImageData(cols, rows);
  const shift = pitchShift(s);
  for (let xi = 0; xi < cols; xi++) {
    const t0 = m.t(GUTTER + xi);
    const t1 = m.t(GUTTER + xi + 1);
    const f0 = Math.max(0, Math.floor(t0 / roll.hopSec));
    const f1 = Math.min(roll.frames, Math.max(f0 + 1, Math.floor(t1 / roll.hopSec)));
    for (let r = 0; r < rows; r++) {
      // row 0 is the top (highest displayed note)
      const note = rows - 1 - r - shift;
      let v = 0;
      if (note >= 0 && note < rows && t0 >= 0) {
        for (let f = f0; f < f1; f++) {
          const val = roll.data[f * rows + note];
          if (val > v) v = val;
        }
      }
      const li = Math.round(v * 255) * 4;
      const o = (r * cols + xi) * 4;
      img.data[o] = ROLL_LUT[li];
      img.data[o + 1] = ROLL_LUT[li + 1];
      img.data[o + 2] = ROLL_LUT[li + 2];
      img.data[o + 3] = 255;
    }
  }
  const tmp = document.createElement('canvas');
  tmp.width = cols;
  tmp.height = rows;
  tmp.getContext('2d')!.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, GUTTER * (ctx.canvas.width / w), 0, cols * (ctx.canvas.width / w), h * (ctx.canvas.height / h));
}

// ---------------------------------------------------------------- component

export function Timeline() {
  const hasFile = useStore((s) => s.file !== null);
  const showRoll = useStore((s) => s.showRoll);
  const duration = useStore((s) => s.file?.duration ?? 0);
  const markerCount = useStore((s) => s.markers.length);
  const overviewRef = useRef<HTMLCanvasElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const rollRef = useRef<HTMLCanvasElement>(null);
  const hover = useRef<number | null>(null);
  const waveLayer = useRef<Layer | null>(null);
  const overviewLayer = useRef<Layer | null>(null);
  const rollLayer = useRef<Layer | null>(null);

  useTimelinePointer(waveRef, hover, true);
  useTimelinePointer(rollRef, hover, false, showRoll);

  // overview: click/drag to move the visible window.
  // Re-runs on `hasFile` because there is no canvas to attach to until a file is open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    const canvas = overviewRef.current;
    if (!canvas) return;
    let dragging = false;
    const go = (e: PointerEvent) => {
      const s = store.get();
      if (!s.file) return;
      const r = canvas.getBoundingClientRect();
      const t = ((e.clientX - r.left - GUTTER) / (r.width - GUTTER)) * s.file.duration;
      const span = s.view.end - s.view.start;
      c.setView(t - span / 2, t + span / 2);
    };
    const down = (e: PointerEvent) => {
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
      go(e);
    };
    const move = (e: PointerEvent) => dragging && go(e);
    const up = () => (dragging = false);
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
    };
  }, [hasFile]);

  useAnimationFrame(() => {
    const s = store.get();
    if (!s.file) return;
    const pos = engine.getPosition();
    c.followPlayhead(pos);
    const st = store.get(); // view may have changed

    // ---- overview
    const ov = overviewRef.current;
    if (ov) {
      const [w, h, dpr] = fitCanvas(ov);
      const ctx = ov.getContext('2d')!;
      const full = { ...st, view: { start: 0, end: st.file!.duration } };
      const layer = cachedLayer(overviewLayer, `${ov.width}x${ov.height}:${st.file!.name}:${st.file!.duration}`, ov.width, ov.height, (lc) => {
        lc.fillStyle = COL.bg;
        lc.fillRect(0, 0, ov.width, ov.height);
        drawWaveLayer(lc, full, w, 0, h, dpr);
      });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(layer, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = COL.gutter;
      ctx.fillRect(0, 0, GUTTER, h);
      ctx.fillStyle = COL.ruler;
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillText('Overview', 4, h / 2 + 3);
      drawLoop(ctx, full, w, 0, h);
      drawMarkers(ctx, full, w, 0, h, false);
      const m = mapping(full, w);
      ctx.strokeStyle = '#e6e8ee';
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      const vx0 = m.x(st.view.start);
      const vx1 = Math.max(vx0 + 2, m.x(st.view.end));
      ctx.fillRect(vx0, 0, vx1 - vx0, h);
      ctx.strokeRect(vx0 + 0.5, 0.5, vx1 - vx0 - 1, h - 1);
      drawPlayhead(ctx, full, w, h, pos, null);
    }

    // ---- waveform + ruler + markers
    const wv = waveRef.current;
    if (wv) {
      const [w, h, dpr] = fitCanvas(wv);
      const ctx = wv.getContext('2d')!;
      const waveTop = RULER_H;
      const layer = cachedLayer(waveLayer, `${wv.width}x${wv.height}:${st.file!.name}:${st.view.start}:${st.view.end}`, wv.width, wv.height, (lc) => {
        lc.fillStyle = COL.bg;
        lc.fillRect(0, 0, wv.width, wv.height);
        drawWaveLayer(lc, st, w, waveTop + 16, h - waveTop - 16, dpr);
      });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(layer, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawRuler(ctx, st, w);
      if (st.gridVisible) drawGrid(ctx, st, w, 0, h, true);
      drawLoop(ctx, st, w, waveTop, h);
      drawMarkers(ctx, st, w, waveTop, h, true);
      ctx.fillStyle = COL.gutter;
      ctx.fillRect(0, RULER_H, GUTTER, h - RULER_H);
      ctx.fillStyle = COL.ruler;
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillText('Wave', 4, (waveTop + h) / 2 + 3);
      drawPlayhead(ctx, st, w, h, pos, hover.current);
      if (hover.current !== null) {
        const m = mapping(st, w);
        const label = fmtTime(hover.current);
        ctx.font = '10px ui-monospace, monospace';
        const tw = ctx.measureText(label).width + 6;
        const hx = Math.min(w - tw, m.x(hover.current) + 4);
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(hx, h - 16, tw, 14);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, hx + 3, h - 6);
      }
    }

    // ---- pitch roll
    const rl = rollRef.current;
    if (rl) {
      const [w, h, dpr] = fitCanvas(rl);
      const ctx = rl.getContext('2d')!;
      const roll = st.analysis.roll;
      const layer = cachedLayer(
        rollLayer,
        `${rl.width}x${rl.height}:${st.file!.name}:${st.view.start}:${st.view.end}:${roll ? roll.frames : 0}:${pitchShift(st)}`,
        rl.width,
        rl.height,
        (lc) => {
          lc.fillStyle = COL.bg;
          lc.fillRect(0, 0, rl.width, rl.height);
          renderRollLayer(lc, st, w, h);
        },
      );
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(layer, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const rows = roll?.noteCount ?? 85;
      const noteMin = roll?.noteMin ?? 24;
      const rowH = h / rows;
      // gutter keyboard
      for (let r = 0; r < rows; r++) {
        const midi = noteMin + rows - 1 - r;
        const black = [1, 3, 6, 8, 10].includes(midi % 12);
        ctx.fillStyle = black ? '#20242d' : '#2c313c';
        ctx.fillRect(0, r * rowH, GUTTER, rowH);
        if (midi % 12 === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          ctx.fillRect(GUTTER, (r + 1) * rowH - 0.5, w - GUTTER, 1);
          ctx.fillStyle = '#c8ccd6';
          ctx.font = '9px system-ui, sans-serif';
          ctx.fillText(noteName(midi + st.transposeDisplay), 4, (r + 1) * rowH - 1);
        }
      }
      if (!roll) {
        ctx.fillStyle = COL.ruler;
        ctx.font = '12px system-ui, sans-serif';
        const msg =
          st.analysis.status === 'running' ? `Analysing pitches… ${Math.round(st.analysis.progress * 100)}%` : st.analysis.status === 'error' ? 'Pitch analysis failed' : '';
        ctx.fillText(msg, GUTTER + 12, h / 2);
      }
      if (st.gridVisible) drawGrid(ctx, st, w, 0, h, false);
      drawLoop(ctx, st, w, 0, h);
      drawMarkers(ctx, st, w, 0, h, false);
      drawPlayhead(ctx, st, w, h, pos, hover.current);
    }
  });

  if (!hasFile) return null;
  // The canvases are the app's main output but have no DOM of their own, so each one
  // describes what it draws. The descriptions deliberately leave out the playhead and
  // visible window, which change many times a second; AnalysisStatus announces the
  // things worth hearing about (key, tempo).
  return (
    <section className="timeline" aria-label="Timeline">
      <canvas
        ref={overviewRef}
        className="tl-overview"
        role="img"
        aria-label={`Overview of the whole recording, ${fmtTime(duration, 0)} long, with the visible window highlighted. Drag to move it.`}
      />
      <canvas
        ref={waveRef}
        className="tl-wave"
        role="img"
        aria-label={`Waveform with time ruler, loop region and ${markerCount === 1 ? '1 marker' : `${markerCount} markers`}. Click to move the playhead, drag to select a loop.`}
      />
      {showRoll && (
        <canvas
          ref={rollRef}
          className="tl-roll"
          role="img"
          aria-label="Pitch roll: brightness shows how strongly each note sounds over time, on a piano keyboard from low notes at the bottom."
          title="Pitch roll: brightness shows how strongly each note sounds over time"
        />
      )}
    </section>
  );
}
