import { useEffect, useRef } from 'react';
import { engine } from '../audio/engine';
import { EQ_PRESETS } from '../controller';
import { store, useStore, type ChannelMode, type EqState } from '../store';
import { clamp, fmtFreq } from '../util';
import { Panel, Segmented, Slider, Toggle, fitCanvas, useAnimationFrame } from './controls';

const CHANNELS: { value: ChannelMode; label: string; title: string }[] = [
  { value: 'stereo', label: 'Stereo', title: 'Original stereo' },
  { value: 'mono', label: 'Mono', title: 'Mix both channels' },
  { value: 'left', label: 'Left', title: 'Left channel only' },
  { value: 'right', label: 'Right', title: 'Right channel only' },
  { value: 'swap', label: 'Swap', title: 'Swap left and right' },
  { value: 'karaoke', label: 'Karaoke', title: 'Cancel centre-panned sound (often the lead vocal)' },
];

const F_MIN = 20;
const F_MAX = 20000;
const G_RANGE = 24;

const setEq = (patch: Partial<EqState>) => store.set((s) => ({ eq: { ...s.eq, ...patch } }));
const setBand = (i: number, patch: Partial<EqState['bands'][number]>) =>
  store.set((s) => ({ eq: { ...s.eq, bands: s.eq.bands.map((b, j) => (j === i ? { ...b, ...patch } : b)) } }));

function EqCurve() {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<number | null>(null);

  const layout = (w: number, h: number) => ({
    x: (f: number) => (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * w,
    f: (x: number) => F_MIN * Math.pow(F_MAX / F_MIN, clamp(x / w, 0, 1)),
    y: (db: number) => h / 2 - (db / G_RANGE) * (h / 2 - 8),
    db: (y: number) => ((h / 2 - y) / (h / 2 - 8)) * G_RANGE,
  });

  useAnimationFrame(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const [w, h, dpr] = fitCanvas(canvas);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const L = layout(w, h);
    const s = store.get();

    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.fillStyle = '#6b7282';
    ctx.font = '9px system-ui, sans-serif';
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      const x = Math.round(L.x(f)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.fillText(fmtFreq(f), x + 2, h - 3);
    }
    for (const db of [-12, 0, 12]) {
      const y = Math.round(L.y(db)) + 0.5;
      ctx.strokeStyle = db === 0 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.07)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillText(`${db > 0 ? '+' : ''}${db}`, 2, y - 2);
    }

    const n = Math.max(64, Math.floor(w / 2));
    const freqs = new Float32Array(n);
    for (let i = 0; i < n; i++) freqs[i] = F_MIN * Math.pow(F_MAX / F_MIN, i / (n - 1));
    const total = new Float32Array(n).fill(1);
    const mag = new Float32Array(n);
    const phase = new Float32Array(n);
    const filters = engine.chain?.filters ?? [];
    for (const f of filters) {
      f.getFrequencyResponse(freqs, mag, phase);
      for (let i = 0; i < n; i++) total[i] *= mag[i];
    }
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const db = filters.length ? 20 * Math.log10(Math.max(total[i], 1e-6)) : 0;
      const x = L.x(freqs[i]);
      const y = clamp(L.y(db), 0, h);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = s.eq.enabled ? '#f5a524' : '#6b7282';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineTo(w, L.y(0));
    ctx.lineTo(0, L.y(0));
    ctx.closePath();
    ctx.fillStyle = s.eq.enabled ? 'rgba(245,165,36,0.10)' : 'rgba(120,120,120,0.08)';
    ctx.fill();
    ctx.lineWidth = 1;

    s.eq.bands.forEach((b, i) => {
      const x = L.x(b.freq);
      const y = L.y(b.gain);
      ctx.beginPath();
      ctx.arc(x, y, drag.current === i ? 8 : 6, 0, Math.PI * 2);
      ctx.fillStyle = drag.current === i ? '#fff' : '#5b8def';
      ctx.fill();
      ctx.fillStyle = '#0c0e12';
      ctx.font = '600 9px system-ui, sans-serif';
      ctx.fillText(String(i + 1), x - 2.5, y + 3);
    });
  });

  useEffect(() => {
    const canvas = ref.current!;
    const local = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, L: layout(r.width, r.height) };
    };
    const nearest = (x: number, y: number, L: ReturnType<typeof layout>) => {
      let best = -1;
      let bestD = 18;
      store.get().eq.bands.forEach((b, i) => {
        const d = Math.hypot(L.x(b.freq) - x, L.y(b.gain) - y);
        if (d < bestD) [best, bestD] = [i, d];
      });
      return best;
    };
    const down = (e: PointerEvent) => {
      const { x, y, L } = local(e);
      const i = nearest(x, y, L);
      if (i >= 0) {
        drag.current = i;
        canvas.setPointerCapture(e.pointerId);
        if (!store.get().eq.enabled) setEq({ enabled: true });
      }
    };
    const move = (e: PointerEvent) => {
      const { x, y, L } = local(e);
      if (drag.current === null) {
        canvas.style.cursor = nearest(x, y, L) >= 0 ? 'grab' : 'default';
        return;
      }
      setBand(drag.current, { freq: Math.round(L.f(x)), gain: Math.round(clamp(L.db(y), -G_RANGE, G_RANGE) * 2) / 2 });
    };
    const up = () => (drag.current = null);
    const wheel = (e: WheelEvent) => {
      const { x, y, L } = local(e);
      const i = drag.current ?? nearest(x, y, L);
      if (i < 0) return;
      e.preventDefault();
      const q = store.get().eq.bands[i].q;
      setBand(i, { q: Math.round(clamp(q * Math.exp(-e.deltaY * 0.003), 0.2, 12) * 100) / 100 });
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('wheel', wheel);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className="eq-canvas"
      role="img"
      aria-label="Equaliser response curve, 20 Hz to 20 kHz. The numbered points are the bands below; drag one to boost or cut, scroll over it to change its width."
      title="Drag the numbered points to boost/cut; scroll over a point to change its width (Q)"
    />
  );
}

export function SoundPanel() {
  const channelMode = useStore((s) => s.channelMode);
  const keepBass = useStore((s) => s.karaokeKeepBass);
  const volume = useStore((s) => s.volume);
  const pan = useStore((s) => s.pan);
  const eq = useStore((s) => s.eq);

  return (
    <Panel
      title="Sound: channels & EQ"
      className="sound-panel"
      actions={
        <>
          <select
            value=""
            onChange={(e) => {
              const preset = EQ_PRESETS[e.target.value];
              if (preset) store.set({ eq: preset(store.get().eq) });
            }}
            title="EQ presets for isolating instruments"
            aria-label="EQ preset"
          >
            <option value="">EQ preset…</option>
            {Object.keys(EQ_PRESETS).map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <Toggle checked={eq.enabled} onChange={(v) => setEq({ enabled: v })}>
            EQ
          </Toggle>
        </>
      }
    >
      <div className="field-row wrap">
        <Segmented value={channelMode} options={CHANNELS} onChange={(v) => store.set({ channelMode: v })} ariaLabel="Channels" />
        {channelMode === 'karaoke' && (
          <Toggle checked={keepBass} onChange={(v) => store.set({ karaokeKeepBass: v })} title="Add back low frequencies removed by centre cancellation">
            Keep bass
          </Toggle>
        )}
      </div>

      <EqCurve />

      <div className="eq-bands">
        {eq.bands.map((b, i) => (
          <div key={i} className="eq-band">
            <span className="band-num">{i + 1}</span>
            <Slider label="Gain" ariaLabel={`Band ${i + 1} gain`} value={b.gain} min={-24} max={24} step={0.5} defaultValue={0} onChange={(v) => setBand(i, { gain: v })} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`} />
            <Slider label="Freq" ariaLabel={`Band ${i + 1} frequency`} value={b.freq} min={20} max={20000} step={1} scale="log" onChange={(v) => setBand(i, { freq: v })} format={(v) => `${fmtFreq(v)} Hz`} />
            <Slider label="Q" ariaLabel={`Band ${i + 1} width (Q)`} value={b.q} min={0.2} max={12} step={0.05} defaultValue={0.9} onChange={(v) => setBand(i, { q: v })} format={(v) => v.toFixed(2)} />
          </div>
        ))}
      </div>

      <div className="field-row wrap">
        <div className="filter-ctl">
          <Toggle checked={eq.hpOn} onChange={(v) => setEq({ hpOn: v, enabled: true })}>High-pass</Toggle>
          <Slider label="" ariaLabel="High-pass frequency" value={eq.hpFreq} min={20} max={5000} step={1} scale="log" disabled={!eq.hpOn} onChange={(v) => setEq({ hpFreq: v })} format={(v) => `${fmtFreq(v)} Hz`} />
        </div>
        <div className="filter-ctl">
          <Toggle checked={eq.lpOn} onChange={(v) => setEq({ lpOn: v, enabled: true })}>Low-pass</Toggle>
          <Slider label="" ariaLabel="Low-pass frequency" value={eq.lpFreq} min={200} max={20000} step={1} scale="log" disabled={!eq.lpOn} onChange={(v) => setEq({ lpFreq: v })} format={(v) => `${fmtFreq(v)} Hz`} />
        </div>
      </div>

      <div className="field-row wrap">
        <Slider label="Volume" value={volume * 100} min={0} max={200} step={1} defaultValue={100} onChange={(v) => store.set({ volume: v / 100 })} format={(v) => `${Math.round(v)}%`} />
        <Slider
          label="Balance"
          value={pan}
          min={-1}
          max={1}
          step={0.01}
          defaultValue={0}
          onChange={(v) => store.set({ pan: v })}
          format={(v) => (Math.abs(v) < 0.01 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)}
        />
      </div>
    </Panel>
  );
}
