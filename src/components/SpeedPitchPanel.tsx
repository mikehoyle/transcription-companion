import * as c from '../controller';
import { store, useStore } from '../store';
import { NumberField, Panel, Slider, Toggle } from './controls';

const SPEED_PRESETS = [0.25, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.25, 1.5];

export function SpeedPitchPanel() {
  const rate = useStore((s) => s.rate);
  const semitones = useStore((s) => s.semitones);
  const cents = useStore((s) => s.cents);
  const formant = useStore((s) => s.formant);

  return (
    <Panel
      title="Speed & pitch"
      actions={
        <button className="link-btn" onClick={c.resetSpeedPitch} title="Reset speed and pitch (0)">
          Reset
        </button>
      }
    >
      <div className="field-row">
        <Slider
          label="Speed"
          value={rate * 100}
          min={25}
          max={200}
          step={1}
          defaultValue={100}
          onChange={(v) => c.setRate(v / 100)}
          format={() => ''}
          title="Change speed without changing pitch (−/=). Double-click to reset."
        />
        <NumberField value={Math.round(rate * 1000) / 10} min={5} max={400} step={1} onChange={(v) => c.setRate(v / 100)} suffix="%" width="4.2em" title="Speed in percent (5–400%)" />
      </div>
      <div className="preset-row">
        {SPEED_PRESETS.map((p) => (
          <button key={p} className={`chip small ${Math.abs(rate - p) < 1e-3 ? 'on' : ''}`} onClick={() => c.setRate(p)}>
            {Math.round(p * 100)}%
          </button>
        ))}
      </div>

      <div className="field-row">
        <Slider
          label="Transpose"
          value={semitones}
          min={-12}
          max={12}
          step={1}
          defaultValue={0}
          onChange={c.setSemitones}
          format={() => ''}
          title="Shift pitch in semitones without changing speed (↑/↓)"
        />
        <NumberField value={semitones} min={-24} max={24} step={1} onChange={c.setSemitones} suffix="st" width="3.2em" format={(v) => (v > 0 ? `+${v}` : String(v))} />
      </div>
      <div className="preset-row">
        <button className="chip small" onClick={() => c.setSemitones(semitones - 12)}>−8va</button>
        <button className="chip small" onClick={() => c.setSemitones(semitones - 1)}>−1</button>
        <button className="chip small" onClick={() => c.setSemitones(0)}>0</button>
        <button className="chip small" onClick={() => c.setSemitones(semitones + 1)}>+1</button>
        <button className="chip small" onClick={() => c.setSemitones(semitones + 12)}>+8va</button>
      </div>

      <div className="field-row">
        <Slider
          label="Fine tune"
          value={cents}
          min={-100}
          max={100}
          step={1}
          defaultValue={0}
          onChange={c.setCents}
          format={() => ''}
          title="Fine tune in cents — match a recording that isn't at A=440 (Shift+↑/↓)"
        />
        <NumberField value={cents} min={-100} max={100} step={1} onChange={c.setCents} suffix="¢" width="3.2em" format={(v) => (v > 0 ? `+${v}` : String(v))} />
      </div>
      <p className="hint">
        A4 = {(440 * Math.pow(2, cents / 1200)).toFixed(1)} Hz equivalent
      </p>

      <Toggle checked={formant} onChange={(v) => store.set({ formant: v })} title="Keeps voices sounding natural when transposing">
        Preserve vocal timbre (formants)
      </Toggle>
    </Panel>
  );
}
