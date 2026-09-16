import { useEffect, useState } from 'react';
import { engine } from '../audio/engine';
import { formatChord, pcName } from '../audio/music';
import { store, useStore } from '../store';

/** How often the chord under the playhead is re-read. */
const POLL_MS = 500;

/**
 * Screen-reader access to what the timeline and keyboard canvases draw: the
 * detected key and tempo, and the chord under the playhead.
 *
 * The text is kept current at all times so it reads correctly when browsed,
 * but the chord changes several times a second during playback, which would
 * make a live region unusable — so announcements are turned off while playing
 * and resume when playback stops, which is when someone is reading a chord
 * anyway.
 */
export function AnalysisStatus() {
  const status = useStore((s) => s.analysis.status);
  const key = useStore((s) => s.analysis.key);
  const bpm = useStore((s) => s.tempo.bpm);
  const playing = useStore((s) => s.playing);
  const shift = useStore((s) => Math.round(s.semitones + s.cents / 100) + s.transposeDisplay);
  const [chord, setChord] = useState('');

  useEffect(() => {
    const read = () => {
      const pos = engine.getPosition();
      const seg = store.get().analysis.chords.find((c) => pos >= c.start && pos < c.end);
      setChord(seg ? formatChord(seg, shift) : '');
    };
    read();
    const id = setInterval(read, POLL_MS);
    return () => clearInterval(id);
  }, [shift]);

  const parts: string[] = [];
  if (status === 'running') parts.push('Analysing audio');
  if (status === 'error') parts.push('Audio analysis failed');
  if (key) parts.push(`Key ${pcName(key.tonic + shift)} ${key.mode}`);
  parts.push(`${Math.round(bpm * 10) / 10} BPM`);
  if (chord) parts.push(`Chord at the playhead: ${chord}`);

  return (
    <p className="sr-only" role="status" aria-live={playing ? 'off' : 'polite'}>
      {parts.join('. ')}
    </p>
  );
}
