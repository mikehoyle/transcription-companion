import * as c from './controller';
import { store } from './store';
import { isTextInput } from './util';

export interface Shortcut {
  keys: string;
  description: string;
  group: string;
}

export const SHORTCUTS: Shortcut[] = [
  { group: 'Transport', keys: 'Space', description: 'Play / pause' },
  { group: 'Transport', keys: 'Backspace', description: 'Return to where playback last started' },
  { group: 'Transport', keys: '← / →', description: 'Back / forward 1 s (Shift: 5 s, Alt: 1 bar)' },
  { group: 'Transport', keys: 'Home / End', description: 'Go to start / end' },
  { group: 'Speed & pitch', keys: '- / =', description: 'Speed −/+ 5% (Shift: 1%)' },
  { group: 'Speed & pitch', keys: '↓ / ↑', description: 'Pitch −/+ 1 semitone (Shift: 10 cents)' },
  { group: 'Speed & pitch', keys: '0', description: 'Reset speed and pitch' },
  { group: 'Loop', keys: '[ / ]', description: 'Set loop start / end at playhead' },
  { group: 'Loop', keys: 'L', description: 'Toggle looping' },
  { group: 'Loop', keys: 'Shift+[ / Shift+]', description: 'Move loop to previous / next phrase' },
  { group: 'Loop', keys: 'S', description: 'Save current loop' },
  { group: 'Markers', keys: 'M', description: 'Add marker at playhead (works while playing)' },
  { group: 'Markers', keys: 'Shift+M', description: 'Add section marker' },
  { group: 'Markers', keys: '1 … 9', description: 'Jump to marker N' },
  { group: 'Markers', keys: ', / .', description: 'Previous / next marker' },
  { group: 'Tempo', keys: 'T', description: 'Tap tempo' },
  { group: 'Tempo', keys: 'B', description: 'Set downbeat (bar 1) at playhead' },
  { group: 'Tempo', keys: 'G', description: 'Toggle beat grid' },
  { group: 'Tempo', keys: 'K', description: 'Toggle metronome' },
  { group: 'View', keys: 'Z / X', description: 'Zoom in / out' },
  { group: 'View', keys: 'Shift+Z', description: 'Zoom to loop / whole file' },
  { group: 'View', keys: 'F', description: 'Toggle follow playhead' },
  { group: 'View', keys: 'Ctrl/⌘ + wheel', description: 'Zoom waveform at mouse' },
  { group: 'View', keys: '?', description: 'Show this help' },
];

export function installShortcuts() {
  const onKey = (e: KeyboardEvent) => {
    if (isTextInput(e.target) || e.metaKey || e.ctrlKey) return;
    const s = store.get();
    if (e.key === 'Escape' && s.helpOpen) {
      store.set({ helpOpen: false });
      return;
    }
    if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
      store.set({ helpOpen: !s.helpOpen });
      e.preventDefault();
      return;
    }
    if (!s.file) return;
    const shift = e.shiftKey;
    // Match on the produced character (layout-aware) rather than the physical key.
    // Shifted symbols are listed alongside their unshifted keys for US layouts.
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    let handled = true;
    switch (key) {
      case ' ':
      case 'Spacebar':
        c.togglePlay();
        break;
      case 'Backspace':
        c.returnToPlayStart();
        break;
      case 'ArrowLeft':
        if (e.altKey) c.seekBars(-1);
        else c.seekRelative(shift ? -5 : -1);
        break;
      case 'ArrowRight':
        if (e.altKey) c.seekBars(1);
        else c.seekRelative(shift ? 5 : 1);
        break;
      case 'Home':
        c.seek(0);
        break;
      case 'End':
        c.seek(s.file.duration);
        break;
      case '-':
      case '_':
        c.nudgeRate(shift ? -0.01 : -0.05);
        break;
      case '=':
      case '+':
        c.nudgeRate(shift ? 0.01 : 0.05);
        break;
      case 'ArrowUp':
        if (shift) c.nudgeCents(10);
        else c.setSemitones(s.semitones + 1);
        break;
      case 'ArrowDown':
        if (shift) c.nudgeCents(-10);
        else c.setSemitones(s.semitones - 1);
        break;
      case '0':
        c.resetSpeedPitch();
        break;
      case '[':
      case '{':
        if (shift) c.shiftLoop(-1);
        else c.setLoopStartHere();
        break;
      case ']':
      case '}':
        if (shift) c.shiftLoop(1);
        else c.setLoopEndHere();
        break;
      case 'l':
        c.toggleLoop();
        break;
      case 's':
        c.saveCurrentLoop();
        break;
      case 'm':
        c.addMarker(shift ? 'section' : 'marker');
        break;
      case ',':
      case '<':
        c.jumpAdjacentMarker(-1);
        break;
      case '.':
      case '>':
        c.jumpAdjacentMarker(1);
        break;
      case 't':
        c.tapTempo();
        break;
      case 'b':
        c.setDownbeatHere();
        break;
      case 'g':
        store.set({ gridVisible: !s.gridVisible });
        break;
      case 'k':
        store.set({ metronome: { ...s.metronome, on: !s.metronome.on } });
        break;
      case 'z':
        if (shift) c.zoomToLoopOrAll();
        else c.zoom(0.5);
        break;
      case 'x':
        c.zoom(2);
        break;
      case 'f':
        store.set({ follow: !s.follow });
        break;
      default:
        if (/^[1-9]$/.test(key)) c.jumpToMarker(Number(key) - 1);
        else handled = false;
    }
    if (handled) {
      e.preventDefault();
      // don't leave a focused button that Space would re-trigger
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
