import * as c from '../controller';
import { pcName } from '../audio/music';
import { store, useStore } from '../store';
import { NumberField, Panel, Segmented, Slider, Toggle } from './controls';

export function TempoPanel() {
  const tempo = useStore((s) => s.tempo);
  const grid = useStore((s) => s.gridVisible);
  const snap = useStore((s) => s.snapToGrid);
  const metronome = useStore((s) => s.metronome);
  const countIn = useStore((s) => s.countIn);
  const analysis = useStore((s) => s.analysis.status);
  const key = useStore((s) => s.analysis.key);
  const shift = useStore((s) => Math.round(s.semitones + s.cents / 100) + s.transposeDisplay);

  const setTempo = (patch: Partial<typeof tempo>) => store.set((s) => ({ tempo: { ...s.tempo, ...patch } }));
  const setCountIn = (patch: Partial<typeof countIn>) => store.set((s) => ({ countIn: { ...s.countIn, ...patch } }));

  return (
    <Panel title="Tempo, metronome & key">
      <div className="tempo-top">
        <div className="bpm-box">
          <NumberField value={tempo.bpm} min={20} max={400} step={0.5} onChange={c.setBpm} width="4.5em" format={(v) => v.toFixed(1)} />
          <span className="field-label">BPM</span>
        </div>
        <button className="chip tap-btn" onClick={c.tapTempo} title="Tap along with the beat (T)">
          Tap
        </button>
        <button className="chip small" onClick={() => c.setBpm(tempo.bpm / 2)} title="Half tempo">½</button>
        <button className="chip small" onClick={() => c.setBpm(tempo.bpm * 2)} title="Double tempo">×2</button>
        {tempo.detectedBpm !== null && Math.abs(tempo.detectedBpm - tempo.bpm) > 0.05 && (
          <button className="link-btn" onClick={() => c.setBpm(tempo.detectedBpm!)} title="Restore detected tempo">
            detected {tempo.detectedBpm}
          </button>
        )}
        {analysis === 'running' && <span className="hint">detecting…</span>}
      </div>

      <div className="field-row wrap">
        <span className="field-label">Beats per bar</span>
        <Segmented value={tempo.beatsPerBar} options={[2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: String(n) }))} onChange={(v) => setTempo({ beatsPerBar: v })} />
      </div>

      <div className="field-row wrap">
        <button className="chip small" onClick={c.setDownbeatHere} title="Align bar 1 with the playhead (B)">
          Set bar 1 here
        </button>
        <span className="field-label">Grid offset</span>
        <button className="chip tiny" onClick={() => setTempo({ offset: tempo.offset - 0.01 })}>−10ms</button>
        <button className="chip tiny" onClick={() => setTempo({ offset: tempo.offset + 0.01 })}>+10ms</button>
      </div>

      <div className="field-row wrap">
        <Toggle checked={grid} onChange={(v) => store.set({ gridVisible: v })}>Beat grid</Toggle>
        <Toggle checked={snap} onChange={(v) => store.set({ snapToGrid: v, gridVisible: v || grid })} title="Snap loops and markers to beats">
          Snap to beats
        </Toggle>
      </div>

      <div className="subsection">
        <div className="subsection-head">
          <h3>Metronome</h3>
          <Toggle checked={metronome.on} onChange={(v) => store.set({ metronome: { ...metronome, on: v } })} title="Click along with the beat grid (K)">
            {metronome.on ? 'On' : 'Off'}
          </Toggle>
        </div>
        <Slider label="Click volume" value={metronome.volume * 100} min={0} max={100} step={1} onChange={(v) => store.set({ metronome: { ...metronome, volume: v / 100 } })} format={(v) => `${Math.round(v)}%`} />
      </div>

      <div className="subsection">
        <div className="subsection-head">
          <h3>Count-in</h3>
          <Segmented value={countIn.bars} options={[1, 2].map((n) => ({ value: n, label: `${n} bar${n > 1 ? 's' : ''}` }))} onChange={(v) => setCountIn({ bars: v })} />
        </div>
        <div className="field-row wrap">
          <Toggle checked={countIn.onPlay} onChange={(v) => setCountIn({ onPlay: v })}>Before playing</Toggle>
          <Toggle checked={countIn.onLoop} onChange={(v) => setCountIn({ onLoop: v })}>Before each loop repeat</Toggle>
        </div>
      </div>

      <div className="subsection">
        <div className="subsection-head">
          <h3>Estimated key</h3>
          <span className="key-name">{key ? `${pcName(key.tonic + shift)} ${key.mode}` : analysis === 'running' ? '…' : '—'}</span>
        </div>
      </div>
    </Panel>
  );
}
