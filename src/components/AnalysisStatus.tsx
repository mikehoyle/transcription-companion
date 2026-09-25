import { pcName } from '../audio/music';
import { useStore } from '../store';

/**
 * Screen-reader access to what the timeline canvases draw: the detected key and
 * tempo. Announcements are turned off while playing so they don't interrupt.
 */
export function AnalysisStatus() {
  const status = useStore((s) => s.analysis.status);
  const key = useStore((s) => s.analysis.key);
  const bpm = useStore((s) => s.tempo.bpm);
  const playing = useStore((s) => s.playing);
  const shift = useStore((s) => Math.round(s.semitones + s.cents / 100) + s.transposeDisplay);

  const parts: string[] = [];
  if (status === 'running') parts.push('Analysing audio');
  if (status === 'error') parts.push('Audio analysis failed');
  if (key) parts.push(`Key ${pcName(key.tonic + shift)} ${key.mode}`);
  parts.push(`${Math.round(bpm * 10) / 10} BPM`);

  return (
    <p className="sr-only" role="status" aria-live={playing ? 'off' : 'polite'}>
      {parts.join('. ')}
    </p>
  );
}
