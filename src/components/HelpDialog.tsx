import { useEffect, useRef } from 'react';
import { SHORTCUTS } from '../shortcuts';
import { store, useStore } from '../store';
import { Icon } from './Icon';

export function HelpDialog() {
  const open = useStore((s) => s.helpOpen);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const groups = [...new Set(SHORTCUTS.map((s) => s.group))];

  return (
    <dialog ref={ref} className="help" onClose={() => store.set({ helpOpen: false })} onClick={(e) => e.target === ref.current && store.set({ helpOpen: false })}>
      <header>
        <h2>Transcription Companion — help</h2>
        <button className="icon-btn" onClick={() => store.set({ helpOpen: false })} title="Close (Esc)">
          <Icon name="close" />
        </button>
      </header>
      <div className="help-body">
        <section>
          <h3>Getting around</h3>
          <ul>
            <li><b>Click</b> the waveform or pitch roll to move the playhead; <b>drag</b> to select a loop.</li>
            <li>Drag loop edges or marker flags to adjust them; double-click a marker flag to rename it.</li>
            <li><b>Wheel</b> scrolls the timeline, <b>Ctrl/⌘/Alt + wheel</b> zooms. Drag on the overview strip to navigate.</li>
            <li>The <b>pitch roll</b> shows how strongly each note sounds over time — bright horizontal lines are sustained notes.</li>
            <li>The <b>keyboard panel</b> guesses notes and chord at the playhead. Click a key to hear a reference pitch.</li>
            <li>Tempo and key are detected automatically; correct them with <b>Tap</b> and <b>Set bar 1 here</b> in the Tempo panel.</li>
            <li><b>Speed trainer</b>: enable a loop, set start and target speed — the speed steps up after each N repetitions.</li>
            <li><b>Karaoke</b> mode cancels centre-panned sound (often lead vocal); try <b>Left/Right only</b> for hard-panned parts.</li>
          </ul>
          <p className="muted">
            Everything happens locally in your browser. Audio files are never uploaded anywhere, and nothing is stored when you close
            the tab — use <b>Save session</b> to keep your markers, loops and settings as a file.
          </p>
        </section>
        <section>
          <h3>Keyboard shortcuts</h3>
          {groups.map((g) => (
            <div key={g} className="shortcut-group">
              <h4>{g}</h4>
              <dl>
                {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                  <div key={s.keys} className="shortcut">
                    <dt><kbd>{s.keys}</kbd></dt>
                    <dd>{s.description}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </section>
      </div>
    </dialog>
  );
}
