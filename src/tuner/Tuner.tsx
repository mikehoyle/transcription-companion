import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NOTE_NAMES, noteName } from '../audio/music';
import { NumberField, Segmented, Slider, Toggle } from '../components/controls';
import { Icon } from '../components/Icon';
import { TonePlayer } from './tone';
import type { PlayMode } from './tunings';
import {
  A4_DEFAULT,
  A4_MAX,
  A4_MIN,
  DEFAULT_SETTINGS,
  MIDI_MAX,
  MIDI_MIN,
  OCTAVE_MAX,
  OCTAVE_MIN,
  OFFSET_LIMIT,
  REPEAT_MAX,
  REPEAT_MIN,
  TUNINGS,
  centsBetween,
  clampMidi,
  fmtHz,
  freqOf,
  loadSettings,
  ordinal,
  saveSettings,
  soundingMidi,
  stringNumber,
  tuningById,
  type TunerSettings,
} from './tunings';

/** Voice id for the free reference pitch; strings use `s<index>`. */
const REF = 'ref';
const stringVoice = (i: number) => `s${i}`;

const GROUPS = [...new Set(TUNINGS.map((t) => t.group))];

/** The one voice that is sounding. What it is doing is on show, so the UI carries it. */
interface Sounding {
  id: string;
  /** The mode it was started in, which a later change to the setting must not rewrite. */
  mode: PlayMode;
  /** How long it rings for; `Infinity` for a drone, which sounds until it is stopped. */
  secs: number;
  /** Counts strikes, so a repeat of the same note still reads as a new one. */
  strike: number;
}

export function Tuner() {
  // Starts at the defaults so the build-time render and the first browser render agree;
  // anything saved is applied in an effect just after mount.
  const [settings, setSettings] = useState<TunerSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  /** The one voice that is sounding, if any — the tuner is monophonic. */
  const [playing, setPlaying] = useState<Sounding | null>(null);
  /** The string the readout is showing; starts on the lowest-numbered one. */
  const [current, setCurrent] = useState(0);
  /**
   * Auto-repeat is on out of the box, but it must not sound anything until the visitor has
   * actually played a note: firing on load would light a string up while the browser is
   * still refusing audio without a gesture.
   */
  const [armed, setArmed] = useState(false);

  const strikes = useRef(0);
  const player = useRef<TonePlayer | null>(null);
  // Stable, so the hooks below can declare their dependency on it.
  const getPlayer = useCallback(() => (player.current ??= new TonePlayer()), []);

  const repeating = settings.autoRepeat;
  const tuning = tuningById(settings.tuningId);
  const midis = useMemo(() => tuning.notes.map((_, i) => soundingMidi(tuning, i, settings)), [tuning, settings]);
  const freqs = useMemo(() => midis.map((m) => freqOf(m, settings.a4)), [midis, settings.a4]);
  const refFreq = freqOf(settings.refMidi, settings.a4);

  // Read by the auto-cycle timer and the key handler, which must not be torn down and
  // rebuilt every time a setting changes.
  const live = useRef({ freqs, settings, tuning, current, repeating });
  live.current = { freqs, settings, tuning, current, repeating };

  const update = useCallback((patch: Partial<TunerSettings>) => setSettings((s) => ({ ...s, ...patch })), []);

  // ---------------------------------------------------------------- playback
  const startVoice = useCallback(
    (id: string, freq: number) => {
      const { settings: s } = live.current;
      const secs = getPlayer().play(id, freq, { timbre: s.timbre, mode: s.mode });
      setPlaying({ id, mode: s.mode, secs, strike: ++strikes.current });
      setArmed(true);
    },
    [getPlayer],
  );

  const stopVoice = useCallback(
    (id: string) => {
      getPlayer().stop(id);
      setPlaying((p) => (p?.id === id ? null : p));
    },
    [getPlayer],
  );

  const stopAll = useCallback(() => {
    getPlayer().stopAll();
    setPlaying(null);
    update({ autoRepeat: false });
  }, [update, getPlayer]);

  const toggleString = useCallback(
    (i: number) => {
      const id = stringVoice(i);
      setCurrent(i);
      // Clicking the string that is sounding switches it off, drone or pluck alike: the
      // highlight says it is still going, so the click that lands on it is what has to stop
      // it. Auto-repeat goes off with it — left running, its timer would strike the string
      // again a moment later and the click would look ignored.
      if (getPlayer().isPlaying(id)) {
        stopVoice(id);
        if (live.current.repeating) update({ autoRepeat: false });
      } else startVoice(id, live.current.freqs[i]);
    },
    [startVoice, stopVoice, getPlayer, update],
  );

  // A plucked note stops by itself; drop its highlight when it does.
  useEffect(() => {
    const p = getPlayer();
    p.onEnded = (id) => setPlaying((cur) => (cur?.id === id ? null : cur));
    return () => {
      p.onEnded = null;
      p.dispose();
      player.current = null;
    };
  }, [getPlayer]);

  // ---------------------------------------------------------------- settings plumbing
  useEffect(() => {
    // Auto-repeat isn't restored: stopping a note switches it off, and that shouldn't
    // follow the visitor to their next session. Every visit starts with it on.
    setSettings({ ...loadSettings(), autoRepeat: DEFAULT_SETTINGS.autoRepeat });
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) saveSettings(settings);
  }, [loaded, settings]);

  useEffect(() => getPlayer().setVolume(settings.volume), [settings.volume, getPlayer]);
  useEffect(() => getPlayer().setTimbre(settings.timbre), [settings.timbre, getPlayer]);

  // Changing A4, the octave or a single string re-pitches whatever is sounding rather than
  // retriggering it, so you can slide the reference under a held drone.
  const playingId = playing?.id ?? null;
  useEffect(() => {
    if (playingId === null) return;
    const f = playingId === REF ? refFreq : freqs[Number(playingId.slice(1))];
    if (f !== undefined) getPlayer().retune(playingId, f);
  }, [playingId, freqs, refFreq, getPlayer]);

  // A different instrument has different (and possibly a different number of) strings.
  const selectTuning = (id: string) => {
    stopAll();
    setCurrent(0);
    update({ tuningId: id, offsets: [] });
  };

  const nudgeString = (i: number, delta: number) => {
    const offsets = tuning.notes.map((_, k) => settings.offsets[k] ?? 0);
    offsets[i] = Math.max(-OFFSET_LIMIT, Math.min(OFFSET_LIMIT, offsets[i] + delta));
    update({ offsets });
  };

  const modified = settings.offsets.some((o) => o !== 0);

  // ---------------------------------------------------------------- auto-repeat
  // Sounds the string the readout is on, over and over, so you can keep both hands on the
  // instrument. Picking another string moves the repeat to it (`current` is a dependency).
  useEffect(() => {
    if (!repeating || !armed) return;
    const again = () => startVoice(stringVoice(current), live.current.freqs[current]);
    // Whatever brought us here — a click, an arrow key — has just sounded this string, so
    // only strike it now if it isn't already ringing; otherwise wait for the first interval.
    if (!getPlayer().isPlaying(stringVoice(current))) again();
    const id = setInterval(again, settings.repeatSec * 1000);
    return () => clearInterval(id);
  }, [repeating, armed, current, settings.repeatSec, startVoice, getPlayer]);

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    // Arrow keys always start the note they land on, rather than toggling it off.
    const goToString = (i: number) => {
      setCurrent(i);
      startVoice(stringVoice(i), live.current.freqs[i]);
    };
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      const { tuning: t, settings: s } = live.current;
      const n = t.notes.length;

      if (e.key >= '1' && e.key <= '9') {
        // Keys follow string numbers, so 6 is the low E on a guitar.
        const i = n - Number(e.key);
        if (i >= 0 && i < n) {
          e.preventDefault();
          toggleString(i);
        }
        return;
      }
      switch (e.key) {
        case ' ':
          e.preventDefault();
          stopAll();
          break;
        case 'ArrowRight':
        case 'ArrowLeft': {
          e.preventDefault();
          const from = live.current.current;
          goToString((from + (e.key === 'ArrowRight' ? 1 : n - 1)) % n);
          break;
        }
        case 'ArrowUp':
        case 'ArrowDown':
          e.preventDefault();
          update({ octave: Math.max(OCTAVE_MIN, Math.min(OCTAVE_MAX, s.octave + (e.key === 'ArrowUp' ? 1 : -1))) });
          break;
        case 'r':
          update({ autoRepeat: !s.autoRepeat });
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [startVoice, stopAll, toggleString, update]);

  // ---------------------------------------------------------------- render
  // Guarded: a tuning change resets `current`, but the two land in the same render and a
  // shorter instrument must not index off the end.
  const shown = Math.min(current, tuning.notes.length - 1);
  const currentMidi = midis[shown];
  const currentFreq = freqs[shown];
  const sounding = playing !== null;
  const playingRef = playingId === REF;
  const a4Cents = centsBetween(settings.a4, A4_DEFAULT);

  return (
    <div className="app tuner-page">
      <header className="app-header">
        <a className="brand" href="../" title="Back to the transcription companion">
          <img src="../favicon.svg" alt="" width={26} height={26} />
          <span className="brand-text">
            <span className="brand-name">Learn By Ear</span>
            <span className="brand-subtitle">Tuner</span>
          </span>
        </a>
        <div className="header-actions">
          <a className="btn" href="../">
            <Icon name="return" size={16} /> Transcription companion
          </a>
          <a
            className="icon-btn"
            href="https://github.com/mikehoyle/transcription-companion/issues/new/choose"
            target="_blank"
            rel="noopener noreferrer"
            title="Report an issue"
            aria-label="Report an issue"
          >
            <Icon name="bug" size={20} />
          </a>
        </div>
      </header>

      <main className="tuner">
        <div className="tuner-readout" aria-live="polite">
          <div className={`tuner-note ${sounding ? 'sounding' : ''}`}>{noteName(currentMidi)}</div>
          <div className="tuner-readout-side">
            <div className="tuner-hz">{fmtHz(currentFreq)} Hz</div>
            <div className="tuner-sub">
              {ordinal(stringNumber(tuning, shown))} string · A4 = {settings.a4.toFixed(1)} Hz
              {Math.abs(a4Cents) >= 0.05 && ` (${a4Cents > 0 ? '+' : ''}${a4Cents.toFixed(1)} ¢)`}
            </div>
          </div>
          <div className="tuner-readout-actions">
            <button type="button" className="btn" onClick={stopAll} disabled={!sounding && !repeating} title="Silence everything (Space)">
              <Icon name="pause" size={16} /> Stop
            </button>
          </div>
        </div>

        <section className="tuner-strings-wrap">
          <div className="tuner-picker">
            <label className="inline-field">
              Instrument
              <select value={settings.tuningId} onChange={(e) => selectTuning(e.target.value)} className="tuning-select">
                {GROUPS.map((g) => (
                  <optgroup key={g} label={g}>
                    {TUNINGS.filter((t) => t.group === g).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {modified && (
              <button type="button" className="link-btn" onClick={() => update({ offsets: [] })}>
                Reset to {tuning.name.replace(/\s*\(.*\)$/, '')}
              </button>
            )}
          </div>

          <ol className="tuner-strings">
            {tuning.notes.map((_, i) => {
              const id = stringVoice(i);
              const voice = playing !== null && playing.id === id ? playing : null;
              const on = voice !== null;
              const offset = settings.offsets[i] ?? 0;
              // A drone's halo breathes on until it is switched off; a plucked one dies away
              // over the note's own ring. That halo has to start over on every strike, and a
              // re-render with the same animation-name doesn't restart one — alternating
              // between two identical keyframes is what makes each repeat land afresh.
              const halo = voice === null ? '' : voice.mode === 'drone' ? 'drone' : `pluck ring-${voice.strike % 2}`;
              return (
                <li
                  key={`${tuning.id}:${stringNumber(tuning, i)}`}
                  className={`tuner-string ${on ? `on ${halo}` : ''} ${current === i ? 'current' : ''}`}
                  style={voice !== null && Number.isFinite(voice.secs) ? ({ '--ring': `${voice.secs}s` } as CSSProperties) : undefined}
                >
                  <button
                    type="button"
                    className="string-btn"
                    onClick={() => toggleString(i)}
                    aria-pressed={on}
                    title={`${ordinal(stringNumber(tuning, i))} string — ${noteName(midis[i])}, ${fmtHz(freqs[i])} Hz (key ${stringNumber(tuning, i)})${on ? ' · click to stop' : ''}`}
                  >
                    <span className="string-num">{ordinal(stringNumber(tuning, i))}</span>
                    <span className="string-note">{noteName(midis[i])}</span>
                    <span className="string-hz">{fmtHz(freqs[i])} Hz</span>
                  </button>
                  <div className="string-tweak">
                    <button
                      type="button"
                      className="chip tiny"
                      onClick={() => nudgeString(i, -1)}
                      title={`Lower the ${ordinal(stringNumber(tuning, i))} string a semitone`}
                      aria-label={`Lower the ${ordinal(stringNumber(tuning, i))} string a semitone`}
                    >
                      −
                    </button>
                    <span className={`string-offset ${offset ? 'set' : ''}`}>{offset ? `${offset > 0 ? '+' : ''}${offset}` : '·'}</span>
                    <button
                      type="button"
                      className="chip tiny"
                      onClick={() => nudgeString(i, 1)}
                      title={`Raise the ${ordinal(stringNumber(tuning, i))} string a semitone`}
                      aria-label={`Raise the ${ordinal(stringNumber(tuning, i))} string a semitone`}
                    >
                      +
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
          {tuning.note && <p className="hint">{tuning.note}</p>}
        </section>

        <div className="tuner-panels">
          <section className="panel">
            <header className="panel-head">
              <h2>Sound</h2>
            </header>
            <div className="panel-body">
              <div className="field-row wrap">
                <span className="field-label">Tone</span>
                <Segmented
                  value={settings.timbre}
                  onChange={(timbre) => update({ timbre })}
                  options={[
                    { value: 'pure' as const, label: 'Pure', title: 'A sine wave — no harmonics at all' },
                    { value: 'soft' as const, label: 'Soft', title: 'Flute-like; the fundamental with a little colour' },
                    { value: 'rich' as const, label: 'Rich', title: 'Reed-like. The upper harmonics make beats much easier to hear' },
                  ]}
                />
              </div>
              <div className="field-row wrap">
                <span className="field-label">Note</span>
                <Segmented
                  value={settings.mode}
                  onChange={(mode) => update({ mode })}
                  options={[
                    { value: 'drone' as const, label: 'Drone', title: 'Sounds until you click the string again' },
                    { value: 'pluck' as const, label: 'Pluck', title: 'Struck once and left to ring out, like a plucked string; click it again to stop it early' },
                  ]}
                />
              </div>
              <Slider
                label="Volume"
                value={settings.volume}
                min={0}
                max={1}
                step={0.01}
                defaultValue={0.5}
                onChange={(volume) => update({ volume })}
                format={(v) => `${Math.round(v * 100)}%`}
              />
              <div className="field-row wrap">
                <Toggle checked={repeating} onChange={(autoRepeat) => update({ autoRepeat })} title="Sound the current string again and again, hands-free (R)">
                  Auto-repeat
                </Toggle>
                <label className="inline-field">
                  every
                  <NumberField value={settings.repeatSec} onChange={(repeatSec) => update({ repeatSec })} min={REPEAT_MIN} max={REPEAT_MAX} step={1} width="3.5em" suffix="s" />
                </label>
              </div>
            </div>
          </section>

          <section className="panel">
            <header className="panel-head">
              <h2>Reference pitch</h2>
            </header>
            <div className="panel-body">
              <div className="field-row wrap">
                <Slider
                  label="A4"
                  value={settings.a4}
                  min={A4_MIN}
                  max={A4_MAX}
                  step={0.5}
                  defaultValue={A4_DEFAULT}
                  onChange={(a4) => update({ a4 })}
                  format={(v) => `${v.toFixed(1)} Hz`}
                />
              </div>
              <div className="preset-row">
                {[415, 432, 438, 440, 442, 444].map((hz) => (
                  <button type="button" key={hz} className={`chip small ${settings.a4 === hz ? 'on' : ''}`} onClick={() => update({ a4: hz })}>
                    {hz}
                  </button>
                ))}
                <span className="hint">415 = baroque · 442–444 = many orchestras</span>
              </div>
              <div className="field-row wrap">
                <span className="field-label">Octave shift</span>
                <Segmented
                  value={settings.octave}
                  onChange={(octave) => update({ octave })}
                  options={[-2, -1, 0, 1, 2].map((o) => ({ value: o, label: o === 0 ? '0' : o > 0 ? `+${o}` : String(o) }))}
                  title="Shifts every string. Small speakers can't reproduce a low B — move the reference up an octave and tune to that."
                />
                {settings.octave !== 0 && <span className="hint warn">Sounding {settings.octave > 0 ? 'above' : 'below'} written pitch</span>}
              </div>
              <div className="subsection">
                <div className="subsection-head">
                  <h3>Any note</h3>
                  <span className="hint">
                    {noteName(settings.refMidi)} · {fmtHz(refFreq)} Hz
                  </span>
                </div>
                <div className="preset-row">
                  {NOTE_NAMES.map((name, pc) => {
                    const midi = clampMidi(Math.floor(settings.refMidi / 12) * 12 + pc);
                    return (
                      <button
                        type="button"
                        key={name}
                        className={`chip small ${settings.refMidi % 12 === pc ? 'on' : ''}`}
                        onClick={() => {
                          update({ refMidi: midi });
                          startVoice(REF, freqOf(midi, settings.a4));
                        }}
                      >
                        {name}
                      </button>
                    );
                  })}
                </div>
                <div className="field-row wrap">
                  <span className="field-label">Octave</span>
                  <div className="preset-row">
                    {[1, 2, 3, 4, 5, 6].map((oct) => {
                      const midi = clampMidi((oct + 1) * 12 + (settings.refMidi % 12));
                      return (
                        <button
                          type="button"
                          key={oct}
                          className={`chip small ${Math.floor(settings.refMidi / 12) - 1 === oct ? 'on' : ''}`}
                          onClick={() => {
                            update({ refMidi: midi });
                            startVoice(REF, freqOf(midi, settings.a4));
                          }}
                        >
                          {oct}
                        </button>
                      );
                    })}
                  </div>
                  <button type="button" className={`chip ${playingRef ? 'on' : ''}`} onClick={() => (playingRef ? stopVoice(REF) : startVoice(REF, refFreq))}>
                    {playingRef ? 'Stop' : 'Play'} {noteName(settings.refMidi)}
                  </button>
                  <button
                    type="button"
                    className="chip small"
                    onClick={() => update({ refMidi: clampMidi(settings.refMidi - 1) })}
                    disabled={settings.refMidi <= MIDI_MIN}
                    aria-label="A semitone lower"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="chip small"
                    onClick={() => update({ refMidi: clampMidi(settings.refMidi + 1) })}
                    disabled={settings.refMidi >= MIDI_MAX}
                    aria-label="A semitone higher"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="panel">
            <header className="panel-head">
              <h2>Shortcuts</h2>
            </header>
            <div className="panel-body">
              <dl className="tuner-keys">
                <div className="shortcut">
                  <dt>
                    <kbd>1</kbd>…<kbd>9</kbd>
                  </dt>
                  <dd>Play that string by number — again to stop it</dd>
                </div>
                <div className="shortcut">
                  <dt>
                    <kbd>←</kbd> <kbd>→</kbd>
                  </dt>
                  <dd>Previous / next string</dd>
                </div>
                <div className="shortcut">
                  <dt>
                    <kbd>↑</kbd> <kbd>↓</kbd>
                  </dt>
                  <dd>Shift everything an octave</dd>
                </div>
                <div className="shortcut">
                  <dt>
                    <kbd>R</kbd>
                  </dt>
                  <dd>Auto-repeat on / off</dd>
                </div>
                <div className="shortcut">
                  <dt>
                    <kbd>Space</kbd>
                  </dt>
                  <dd>Stop</dd>
                </div>
              </dl>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
