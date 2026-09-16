import * as c from '../controller';
import { store, useStore } from '../store';
import { NumberField, Panel, Segmented, Slider, Toggle } from './controls';

export function TempoPanel() {
  const tempo = useStore((s) => s.tempo);
  const grid = useStore((s) => s.gridVisible);
  const snap = useStore((s) => s.snapToGrid);
  const metronome = useStore((s) => s.metronome);
  const countIn = useStore((s) => s.countIn);
  const analysis = useStore((s) => s.analysis.status);

  const setTempo = (patch: Partial<typeof tempo>) => store.set((s) => ({ tempo: { ...s.tempo, ...patch } }));
  const setCountIn = (patch: Partial<typeof countIn>) => store.set((s) => ({ countIn: { ...s.countIn, ...patch } }));

  return (
    <Panel title="Tempo & metronome">
      <div className="tempo-top">
        <div className="bpm-box">
          <NumberField value={tempo.bpm} min={20} max={400} step={0.5} onChange={c.setBpm} width="4.5em" format={(v) => v.toFixed(1)} ariaLabel="Tempo in BPM" />
          <span className="field-label">BPM</span>
        </div>
        <button type="button" className="chip tap-btn" onClick={c.tapTempo} title="Tap along with the beat (T)">
          Tap
        </button>
        <button type="button" className="chip small" onClick={() => c.setBpm(tempo.bpm / 2)} title="Half tempo" aria-label="Half tempo">
          ½
        </button>
        <button type="button" className="chip small" onClick={() => c.setBpm(tempo.bpm * 2)} title="Double tempo" aria-label="Double tempo">
          ×2
        </button>
        {tempo.detectedBpm !== null && Math.abs(tempo.detectedBpm - tempo.bpm) > 0.05 && (
          <button type="button" className="link-btn" onClick={() => c.setBpm(tempo.detectedBpm!)} title="Restore detected tempo">
            detected {tempo.detectedBpm}
          </button>
        )}
        {analysis === 'running' && <span className="hint">detecting…</span>}
      </div>

      <div className="field-row wrap">
        <span className="field-label">Beats per bar</span>
        <Segmented
          value={tempo.beatsPerBar}
          options={[2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: String(n) }))}
          onChange={(v) => setTempo({ beatsPerBar: v })}
          ariaLabel="Beats per bar"
        />
      </div>

      <div className="field-row wrap">
        <button type="button" className="chip small" onClick={c.setDownbeatHere} title="Align bar 1 with the playhead (B)">
          Set bar 1 here
        </button>
        <span className="field-label">Grid offset</span>
        <button type="button" className="chip tiny" onClick={() => setTempo({ offset: tempo.offset - 0.01 })} aria-label="Move the beat grid 10 ms earlier">
          −10ms
        </button>
        <button type="button" className="chip tiny" onClick={() => setTempo({ offset: tempo.offset + 0.01 })} aria-label="Move the beat grid 10 ms later">
          +10ms
        </button>
      </div>

      <div className="field-row wrap">
        <Toggle checked={grid} onChange={(v) => store.set({ gridVisible: v })}>
          Beat grid
        </Toggle>
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
        <Slider
          label="Click volume"
          ariaLabel="Metronome click volume"
          value={metronome.volume * 100}
          min={0}
          max={100}
          step={1}
          onChange={(v) => store.set({ metronome: { ...metronome, volume: v / 100 } })}
          format={(v) => `${Math.round(v)}%`}
        />
      </div>

      <div className="subsection">
        <div className="subsection-head">
          <h3>Count-in</h3>
          <Segmented
            value={countIn.bars}
            options={[1, 2].map((n) => ({ value: n, label: `${n} bar${n > 1 ? 's' : ''}` }))}
            onChange={(v) => setCountIn({ bars: v })}
            ariaLabel="Count-in length"
          />
        </div>
        <div className="field-row wrap">
          <Toggle checked={countIn.onPlay} onChange={(v) => setCountIn({ onPlay: v })}>
            Before playing
          </Toggle>
          <Toggle checked={countIn.onLoop} onChange={(v) => setCountIn({ onLoop: v })}>
            Before each loop repeat
          </Toggle>
        </div>
      </div>
    </Panel>
  );
}
