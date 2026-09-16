import { useRef } from 'react';
import { engine } from '../audio/engine';
import * as c from '../controller';
import { store, useStore } from '../store';
import { barBeat, fmtPct, fmtTime } from '../util';
import { useAnimationFrame } from './controls';
import { Icon } from './Icon';

export function Transport() {
  const playing = useStore((s) => s.playing);
  const duration = useStore((s) => s.file?.duration ?? 0);
  const loop = useStore((s) => s.loop);
  const follow = useStore((s) => s.follow);
  const showRoll = useStore((s) => s.showRoll);
  const showNotes = useStore((s) => s.showNotes);
  const gridVisible = useStore((s) => s.gridVisible);
  const rate = useStore((s) => s.rate);
  const semitones = useStore((s) => s.semitones);
  const cents = useStore((s) => s.cents);
  const timeRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);

  useAnimationFrame(() => {
    const s = store.get();
    const p = engine.getPosition();
    if (timeRef.current) timeRef.current.textContent = fmtTime(p);
    if (barRef.current) {
      barRef.current.textContent = s.gridVisible ? `bar ${barBeat(p, s.tempo.bpm, s.tempo.offset, s.tempo.beatsPerBar)}` : '';
    }
  });

  const hasLoop = loop.end - loop.start > 0.02;
  const pitchLabel = `${semitones >= 0 ? '+' : ''}${semitones}${cents ? ` ${cents >= 0 ? '+' : ''}${cents}¢` : ''}`;

  return (
    <div className="transport">
      <div className="transport-group">
        <button className="icon-btn" title="Go to start (Home)" aria-label="Go to start" onClick={() => c.seek(0)}>
          <Icon name="start" />
        </button>
        <button className="icon-btn" title="Return to where playback started (Backspace)" aria-label="Return to where playback started" onClick={c.returnToPlayStart}>
          <Icon name="return" />
        </button>
        <button className="icon-btn" title="Back 5 s (Shift+←)" aria-label="Back 5 seconds" onClick={() => c.seekRelative(-5)}>
          <Icon name="back" />
        </button>
        <button className={`play-btn ${playing ? 'on' : ''}`} title="Play / pause (Space)" aria-label={playing ? 'Pause' : 'Play'} onClick={c.togglePlay}>
          <Icon name={playing ? 'pause' : 'play'} size={26} />
        </button>
        <button className="icon-btn" title="Forward 5 s (Shift+→)" aria-label="Forward 5 seconds" onClick={() => c.seekRelative(5)}>
          <Icon name="forward" />
        </button>
      </div>

      {/* The time updates every frame; role="timer" keeps assistive tech from announcing each tick. */}
      <div className="clock" role="timer" aria-label="Playback position" title="Current position">
        <span ref={timeRef} className="clock-time">
          0:00.00
        </span>
        <span className="clock-total">/ {fmtTime(duration, 1)}</span>
        <span ref={barRef} className="clock-bar" />
      </div>

      <div className="transport-group">
        <button className={`chip ${loop.enabled ? 'on' : ''}`} title="Toggle loop (L)" aria-pressed={loop.enabled} onClick={c.toggleLoop}>
          <Icon name="loop" size={16} /> Loop
        </button>
        <button className="chip" title="Set loop start at playhead ([)" aria-label="Set loop start at playhead" onClick={c.setLoopStartHere}>
          A
        </button>
        <button className="chip" title="Set loop end at playhead (])" aria-label="Set loop end at playhead" onClick={c.setLoopEndHere}>
          B
        </button>
        {hasLoop && (
          <span className="loop-readout" title="Loop region">
            {fmtTime(loop.start)} – {fmtTime(loop.end)}
          </span>
        )}
      </div>

      <div className="transport-group">
        <button className="chip" title="Add marker at playhead (M)" onClick={() => c.addMarker()}>
          <Icon name="marker" size={14} /> Marker
        </button>
      </div>

      <div className="transport-status" title="Current speed and transposition">
        <span className={rate !== 1 ? 'hot' : ''}>{fmtPct(rate)}</span>
        <span className={semitones || cents ? 'hot' : ''}>{pitchLabel} st</span>
      </div>

      <div className="transport-group right">
        <button className={`icon-btn ${gridVisible ? 'on' : ''}`} title="Beat grid (G)" aria-label="Beat grid" aria-pressed={gridVisible} onClick={() => store.set({ gridVisible: !gridVisible })}>
          #
        </button>
        <button className={`icon-btn ${showRoll ? 'on' : ''}`} title="Show pitch roll" aria-label="Show pitch roll" aria-pressed={showRoll} onClick={() => store.set({ showRoll: !showRoll })}>
          <Icon name="roll" />
        </button>
        <button className={`icon-btn ${showNotes ? 'on' : ''}`} title="Show notes & chords" aria-label="Show notes and chords" aria-pressed={showNotes} onClick={() => store.set({ showNotes: !showNotes })}>
          <Icon name="notes" />
        </button>
        <button className={`icon-btn ${follow ? 'on' : ''}`} title="Follow playhead (F)" aria-label="Follow playhead" aria-pressed={follow} onClick={() => store.set({ follow: !follow })}>
          <Icon name="follow" />
        </button>
        <button className="icon-btn" title="Zoom out (X)" aria-label="Zoom out" onClick={() => c.zoom(2)}>
          <Icon name="zoomOut" />
        </button>
        <button className="icon-btn" title="Zoom in (Z)" aria-label="Zoom in" onClick={() => c.zoom(0.5)}>
          <Icon name="zoomIn" />
        </button>
        <button className="icon-btn" title="Zoom to loop / whole file (Shift+Z)" aria-label="Zoom to loop or whole file" onClick={c.zoomToLoopOrAll}>
          <Icon name="fit" />
        </button>
      </div>
    </div>
  );
}
