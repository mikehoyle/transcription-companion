import { type CSSProperties, useEffect, useId, useRef, useState } from 'react';
import { ClickTrack } from '../audio/clickTrack';
import * as c from '../controller';
import { store, useStore } from '../store';
import { NumberField, Slider } from './controls';
import { Icon } from './Icon';

const MIN_BPM = 20;
const MAX_BPM = 400;
const MAX_BEATS = 16;

/** Whole tempos without a trailing ".0"; the rest to one decimal. */
const formatBpm = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** A metronome of its own, in a modal: it needs no file and ignores the song's tempo and grid. */
export function ClickTrackDialog() {
  const open = useStore((s) => s.clickTrackOpen);
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [bpm, setBpm] = useState(120);
  const [beats, setBeats] = useState(4);
  const [on, setOn] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [lit, setLit] = useState<number | null>(null);
  // Counts every click, bar or no bar, so the pendulum can swing one way then the other.
  const [clicks, setClicks] = useState(0);
  const track = useRef<ClickTrack | null>(null);

  useEffect(() => {
    const t = new ClickTrack();
    t.onBeat = (beat) => {
      setLit(beat);
      setClicks((n) => n + 1);
    };
    track.current = t;
    return () => t.dispose();
  }, []);

  useEffect(() => {
    track.current?.set(bpm, beats);
  }, [bpm, beats]);

  useEffect(() => {
    track.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // Two clocks at once would only fight: the song stops while this metronome is up.
      if (store.get().playing) c.pause();
    }
    if (!open && d.open) d.close();
    // Closing the dialog stops the clicks: nothing would be left on screen to turn them off.
    if (!open) {
      track.current?.stop();
      setOn(false);
      setLit(null);
      setClicks(0);
    }
  }, [open]);

  // Started straight from the click, not an effect: some browsers only let audio begin inside the gesture itself.
  function toggle(v: boolean) {
    const t = track.current;
    if (!t) return;
    if (v) t.start();
    else {
      t.stop();
      setLit(null);
      setClicks(0);
    }
    setOn(v);
  }

  const close = () => store.set({ clickTrackOpen: false });
  // One decimal place, as the main tempo field allows.
  const clampBpm = (v: number) => Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(v * 10) / 10));

  return (
    <dialog
      ref={ref}
      className="click-track"
      aria-labelledby={titleId}
      onClose={close}
      onClick={(e) => e.target === ref.current && close()}
      // Esc closes a modal dialog natively, but not for every kind of key event; this backs it up.
      onKeyDown={(e) => e.key === 'Escape' && close()}
    >
      <header>
        <h2 id={titleId}>Metronome</h2>
        <button type="button" className="icon-btn" onClick={close} title="Close (Esc)" aria-label="Close metronome">
          <Icon name="close" />
        </button>
      </header>
      <div className="click-track-body">
        <button
          type="button"
          className={`click-track-toggle ${on ? 'on' : ''}`}
          aria-pressed={on}
          onClick={() => toggle(!on)}
          style={{ '--swing-ms': `${Math.round(60000 / bpm)}ms` } as CSSProperties}
        >
          <MetronomeGlyph swing={on ? (clicks % 2 ? 1 : -1) : 0} />
          <span className="click-track-toggle-label">{on ? 'Stop' : 'Start'}</span>
        </button>

        <div className="beat-dots" aria-hidden>
          {Array.from({ length: Math.max(1, beats) }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the dots are positions in the bar, nothing more
            <span key={i} className={`beat-dot ${i === 0 && beats > 0 ? 'accent' : ''} ${lit === i ? 'lit' : ''}`} />
          ))}
        </div>

        <div className="click-track-row">
          <button type="button" className="chip" onClick={() => setBpm((b) => clampBpm(b - 1))} aria-label="Slower by 1 BPM">
            −
          </button>
          <div className="bpm-box">
            <NumberField
              value={bpm}
              min={MIN_BPM}
              max={MAX_BPM}
              step={1}
              onChange={(v) => setBpm(clampBpm(v))}
              format={formatBpm}
              accept={/^\d{0,3}(\.\d?)?$/}
              commitDelay={1000}
              width="3.8em"
              ariaLabel="Metronome tempo in BPM"
            />
            <span className="field-label">BPM</span>
          </div>
          <button type="button" className="chip" onClick={() => setBpm((b) => clampBpm(b + 1))} aria-label="Faster by 1 BPM">
            +
          </button>
        </div>

        <div className="click-track-row">
          <span className="field-label">Beats per bar (0 for no accent)</span>
          <button type="button" className="chip small" onClick={() => setBeats((b) => Math.max(0, b - 1))} disabled={beats === 0} aria-label="Fewer beats per bar">
            −
          </button>
          <NumberField
            value={beats}
            min={0}
            max={MAX_BEATS}
            step={1}
            onChange={(v) => setBeats(Math.round(v))}
            accept={/^\d{0,2}$/}
            commitDelay={1000}
            width="2.5em"
            ariaLabel="Beats per bar; 0 for no accent"
          />
          <button type="button" className="chip small" onClick={() => setBeats((b) => Math.min(MAX_BEATS, b + 1))} disabled={beats === MAX_BEATS} aria-label="More beats per bar">
            +
          </button>
        </div>

        <Slider
          label="Click volume"
          ariaLabel="Standalone metronome click volume"
          value={volume * 100}
          min={0}
          max={100}
          step={1}
          onChange={(v) => setVolume(v / 100)}
          format={(v) => `${Math.round(v)}%`}
        />
      </div>
    </dialog>
  );
}

/** A pyramid metronome; `swing` tips the pendulum left (−1) or right (1), or holds it upright (0). */
function MetronomeGlyph({ swing }: { swing: -1 | 0 | 1 }) {
  return (
    <svg
      className="metronome-glyph"
      viewBox="0 0 48 56"
      width="56"
      height="64"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <path d="M17 4h14l11 46H6z" />
      <path d="M8.5 40h31" />
      <g className="metronome-arm" style={{ transform: `rotate(${swing * 24}deg)` }}>
        <path d="M24 44V10" />
        <rect x="20" y="17" width="8" height="6" rx="1.5" fill="currentColor" />
      </g>
      <circle cx="24" cy="44" r="2.5" fill="currentColor" />
    </svg>
  );
}
