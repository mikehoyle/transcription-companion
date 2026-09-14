import { useEffect, useRef, useState } from 'react';
import { ACCEPT } from './audio/decode';
import * as c from './controller';
import { installShortcuts } from './shortcuts';
import { store, useStore } from './store';
import { fmtBytes, fmtTime } from './util';
import { HelpDialog } from './components/HelpDialog';
import { Icon } from './components/Icon';
import { LoopPanel } from './components/LoopPanel';
import { MarkersPanel } from './components/MarkersPanel';
import { NotesPanel } from './components/NotesPanel';
import { SoundPanel } from './components/SoundPanel';
import { SpeedPitchPanel } from './components/SpeedPitchPanel';
import { TempoPanel } from './components/TempoPanel';
import { Timeline } from './components/Timeline';
import { Transport } from './components/Transport';
import { VideoView } from './components/VideoView';

const isSessionFile = (f: File) => f.name.endsWith('.json');

function handleFiles(files: FileList | null) {
  if (!files?.length) return;
  const list = Array.from(files);
  const media = list.find((f) => !isSessionFile(f));
  const session = list.find(isSessionFile);
  void (async () => {
    if (media) await c.openFile(media);
    if (session) {
      if (store.get().file) await c.loadSession(session);
      else store.set({ error: 'Open the audio file first, then load its session.' });
    }
  })();
}

function Header() {
  const file = useStore((s) => s.file);
  const hasLoop = useStore((s) => s.loop.end - s.loop.start > 0.02);
  const fileInput = useRef<HTMLInputElement>(null);
  const sessionInput = useRef<HTMLInputElement>(null);

  return (
    <header className="app-header">
      <div className="brand">
        <img src="./favicon.svg" alt="" width={26} height={26} />
        <span className="brand-text">
          <span className="brand-name">Learn By Ear</span>
          <span className="brand-subtitle">Transcription Companion</span>
        </span>
      </div>
      <button className="btn primary" onClick={() => fileInput.current?.click()}>
        <Icon name="open" size={16} /> Open audio / video
      </button>
      <input ref={fileInput} type="file" accept={ACCEPT} hidden onChange={(e) => (handleFiles(e.target.files), (e.target.value = ''))} />
      {file && (
        <div className="file-info" title={file.name}>
          <span className="file-name">{file.name}</span>
          <span className="file-meta">
            {fmtTime(file.duration, 0)} · {(file.sampleRate / 1000).toFixed(1)} kHz · {file.channels === 1 ? 'mono' : `${file.channels} ch`} · {fmtBytes(file.size)}
            {file.decoder === 'ffmpeg' ? ' · via ffmpeg' : ''}
          </span>
        </div>
      )}
      <div className="header-actions">
        {file && (
          <>
            <details className="menu">
              <summary className="btn">
                <Icon name="download" size={16} /> Export
              </summary>
              <div className="menu-items" onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute('open')}>
                <button disabled={!hasLoop} onClick={() => c.exportAudio('loop')}>Loop region as WAV (with speed/pitch/EQ)</button>
                <button onClick={() => c.exportAudio('all')}>Whole file as WAV (with speed/pitch/EQ)</button>
              </div>
            </details>
            <details className="menu">
              <summary className="btn">
                <Icon name="save" size={16} /> Session
              </summary>
              <div className="menu-items" onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute('open')}>
                <button onClick={c.saveSession}>Save markers, loops & settings…</button>
                <button onClick={() => sessionInput.current?.click()}>Load session file…</button>
              </div>
            </details>
            <input
              ref={sessionInput}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void c.loadSession(f);
                e.target.value = '';
              }}
            />
          </>
        )}
        <button className="icon-btn" onClick={() => store.set({ helpOpen: true })} title="Help & shortcuts (?)">
          <Icon name="help" size={20} />
        </button>
      </div>
    </header>
  );
}

function Welcome() {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="welcome">
      <div className="drop-card" onClick={() => input.current?.click()} role="button" tabIndex={0}>
        <div className="drop-icon">
          <Icon name="open" size={40} />
        </div>
        <h1>Drop a song here to start learning it</h1>
        <p>or click to choose an audio or video file</p>
        <p className="formats">
          MP3 · WAV · FLAC · AAC/M4A · OGG · Opus · AIFF · WMA · ALAC · APE · WavPack · AC3 · MP4 · MOV · MKV · WebM · and more
        </p>
        <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => handleFiles(e.target.files)} />
      </div>
      <ul className="feature-grid">
        <li><b>Slow down without pitch change</b><span>5%–400% speed with high-quality time stretching.</span></li>
        <li><b>Transpose & fine-tune</b><span>±24 semitones, cents, formant preservation.</span></li>
        <li><b>A–B loops & speed trainer</b><span>Seamless loops, pauses, count-ins, step-up speed practice.</span></li>
        <li><b>Note & chord guessing</b><span>Pitch spectrum on a keyboard, chord names, pitch roll & chord timeline.</span></li>
        <li><b>Tempo, beats & key</b><span>Auto-detected BPM & key, tap tempo, beat grid, metronome.</span></li>
        <li><b>Isolate parts</b><span>Parametric EQ, karaoke vocal cancel, L/R/mono channels.</span></li>
        <li><b>Markers</b><span>Tap markers while listening, loop between markers.</span></li>
        <li><b>Export & sessions</b><span>Render processed WAVs; save your markers and loops to a file.</span></li>
      </ul>
      <p className="privacy">
        🔒 100% local: files are processed in your browser and never uploaded. Nothing is stored after you close the tab.
      </p>
    </div>
  );
}

function Overlays() {
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  return (
    <>
      {loading && (
        <div className="loading-overlay">
          <div className="loading-card">
            <div className="spinner" />
            <p>{loading.message}</p>
            {loading.progress !== null && (
              <div className="progress">
                <div style={{ width: `${Math.round(loading.progress * 100)}%` }} />
              </div>
            )}
          </div>
        </div>
      )}
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button className="icon-btn small" onClick={() => store.set({ error: null })}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </>
  );
}

export default function App() {
  const hasFile = useStore((s) => s.file !== null);
  const hasVideo = useStore((s) => !!s.file?.videoUrl);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const offController = c.initController();
    const offKeys = installShortcuts();
    return () => {
      offController();
      offKeys();
    };
  }, []);

  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      handleFiles(e.dataTransfer?.files ?? null);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  return (
    <div className="app">
      <Header />
      {hasFile ? (
        <main className="workspace">
          <div className="sticky-top">
            <Transport />
            <Timeline />
          </div>
          <div className={`panels ${hasVideo ? 'with-video' : ''}`}>
            {hasVideo && <VideoView />}
            <SpeedPitchPanel />
            <LoopPanel />
            <TempoPanel />
            <NotesPanel />
            <SoundPanel />
            <MarkersPanel />
          </div>
        </main>
      ) : (
        <Welcome />
      )}
      {dragging && <div className="drag-overlay">Drop to open</div>}
      <Overlays />
      <HelpDialog />
    </div>
  );
}
