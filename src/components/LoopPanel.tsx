import { engine } from '../audio/engine';
import * as c from '../controller';
import { store, useStore } from '../store';
import { fmtPct, fmtTime, parseTime } from '../util';
import { NumberField, Panel, Slider, Toggle } from './controls';
import { Icon } from './Icon';

export function LoopPanel() {
  const loop = useStore((s) => s.loop);
  const loopGap = useStore((s) => s.loopGap);
  const trainer = useStore((s) => s.trainer);
  const loops = useStore((s) => s.loops);
  const rate = useStore((s) => s.rate);
  const hasLoop = loop.end - loop.start > 0.02;

  const setTrainer = (patch: Partial<typeof trainer>) => store.set((s) => ({ trainer: { ...s.trainer, ...patch } }));

  return (
    <Panel
      title="Loop & practice"
      actions={
        <Toggle checked={loop.enabled} onChange={() => c.toggleLoop()} title="Toggle looping (L)">
          Loop
        </Toggle>
      }
    >
      <div className="loop-edges">
        {(['start', 'end'] as const).map((edge) => (
          <div key={edge} className="loop-edge">
            <span className="field-label">{edge === 'start' ? 'A (start)' : 'B (end)'}</span>
            <NumberField
              value={loop[edge]}
              format={(v) => fmtTime(v, 3)}
              parse={parseTime}
              width="6.5em"
              step={0.01}
              onChange={(v) => (edge === 'start' ? c.setLoop(v, loop.end, loop.enabled) : c.setLoop(loop.start, v, true))}
            />
            <div className="nudges">
              <button className="chip tiny" onClick={() => c.nudgeLoop(edge, -0.1)} disabled={!hasLoop}>−.1</button>
              <button className="chip tiny" onClick={() => c.nudgeLoop(edge, -0.01)} disabled={!hasLoop}>−.01</button>
              <button className="chip tiny" onClick={() => c.nudgeLoop(edge, 0.01)} disabled={!hasLoop}>+.01</button>
              <button className="chip tiny" onClick={() => c.nudgeLoop(edge, 0.1)} disabled={!hasLoop}>+.1</button>
            </div>
          </div>
        ))}
      </div>
      <div className="preset-row">
        <button className="chip small" disabled={!hasLoop} onClick={() => c.shiftLoop(-1)} title="Previous phrase (Shift+[)">◀ Prev</button>
        <button className="chip small" disabled={!hasLoop} onClick={() => c.scaleLoop(0.5)} title="Halve loop length">÷2</button>
        <button className="chip small" disabled={!hasLoop} onClick={() => c.scaleLoop(2)} title="Double loop length">×2</button>
        <button className="chip small" disabled={!hasLoop} onClick={() => c.shiftLoop(1)} title="Next phrase (Shift+])">Next ▶</button>
        <button className="chip small" disabled={!hasLoop} onClick={() => c.zoomToRange(loop.start, loop.end)} title="Zoom to loop">Zoom</button>
        {hasLoop && <span className="hint">{(loop.end - loop.start).toFixed(2)} s</span>}
      </div>

      <Slider
        label="Pause between repeats"
        value={loopGap}
        min={0}
        max={5}
        step={0.25}
        defaultValue={0}
        onChange={(v) => store.set({ loopGap: v })}
        format={(v) => (v ? `${v.toFixed(2)} s` : 'off')}
        title="Silence between loop repetitions — time to reposition your hands"
      />

      <div className="subsection">
        <div className="subsection-head">
          <h3>Speed trainer</h3>
          <Toggle
            checked={trainer.enabled}
            onChange={(v) => {
              setTrainer({ enabled: v, rep: 0 });
              if (v) {
                c.setRate(trainer.startRate);
                if (!store.get().loop.enabled) c.toggleLoop();
              }
            }}
            title="Gradually change speed after each set of loop repetitions"
          >
            {trainer.enabled ? `On · ${fmtPct(rate)} · rep ${trainer.rep + 1}/${trainer.repsPerStep}` : 'Off'}
          </Toggle>
        </div>
        <div className="trainer-grid">
          <label>
            Start
            <NumberField value={Math.round(trainer.startRate * 100)} min={5} max={400} suffix="%" width="3.4em" onChange={(v) => setTrainer({ startRate: v / 100 })} />
          </label>
          <label>
            Target
            <NumberField value={Math.round(trainer.targetRate * 100)} min={5} max={400} suffix="%" width="3.4em" onChange={(v) => setTrainer({ targetRate: v / 100 })} />
          </label>
          <label>
            Step
            <NumberField value={Math.round(trainer.step * 100)} min={1} max={50} suffix="%" width="3em" onChange={(v) => setTrainer({ step: v / 100 })} />
          </label>
          <label>
            Every
            <NumberField value={trainer.repsPerStep} min={1} max={50} suffix="reps" width="3em" onChange={(v) => setTrainer({ repsPerStep: Math.round(v) })} />
          </label>
        </div>
        {trainer.enabled && !hasLoop && <p className="hint warn">Select a loop region to use the trainer.</p>}
      </div>

      <div className="subsection">
        <div className="subsection-head">
          <h3>Saved loops</h3>
          <button className="chip small" disabled={!hasLoop} onClick={c.saveCurrentLoop} title="Save current loop (S)">
            + Save current
          </button>
        </div>
        {loops.length === 0 ? (
          <p className="hint">No saved loops yet.</p>
        ) : (
          <ul className="item-list">
            {loops.map((l) => {
              const active = Math.abs(l.start - loop.start) < 1e-3 && Math.abs(l.end - loop.end) < 1e-3;
              return (
                <li key={l.id} className={active ? 'active' : ''}>
                  <button className="chip tiny" onClick={() => c.recallLoop(l.id)} title="Loop this region">
                    <Icon name="loop" size={12} />
                  </button>
                  <input className="inline-edit" value={l.name} onChange={(e) => c.renameLoop(l.id, e.target.value)} />
                  <button className="time-link" onClick={() => engine.seek(l.start)}>
                    {fmtTime(l.start, 1)}–{fmtTime(l.end, 1)}
                  </button>
                  <button className="icon-btn small" onClick={() => c.deleteLoop(l.id)} title="Delete">
                    <Icon name="trash" size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
  );
}
