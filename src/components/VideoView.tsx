import { useRef, useState } from 'react';
import { engine } from '../audio/engine';
import { store, useStore } from '../store';
import { Panel, useAnimationFrame } from './controls';

/**
 * Muted video kept in sync with the (time-stretched) audio engine, which is
 * the master clock.
 */
export function VideoView() {
  const url = useStore((s) => s.file?.videoUrl ?? null);
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useAnimationFrame(() => {
    const v = ref.current;
    if (!v || failed || v.readyState < 1) return;
    const s = store.get();
    const pos = engine.getPosition();
    const sounding = s.playing && engine.isSounding();
    const rate = Math.min(16, Math.max(0.0625, s.rate));
    if (Math.abs(v.playbackRate - rate) > 1e-3) v.playbackRate = rate;
    if (sounding && v.paused) void v.play().catch(() => {});
    if (!sounding && !v.paused) v.pause();
    const drift = Math.abs(v.currentTime - pos);
    if (!v.seeking && drift > (sounding ? 0.3 : 0.03)) v.currentTime = pos;
  });

  if (!url) return null;
  return (
    <Panel title="Video" className="video-panel">
      {failed ? (
        <p className="muted">This browser can’t display this video format, but the audio track is loaded.</p>
      ) : (
        <video ref={ref} src={url} muted playsInline preload="auto" onError={() => setFailed(true)} />
      )}
    </Panel>
  );
}
