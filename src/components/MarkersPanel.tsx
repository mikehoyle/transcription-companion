import * as c from '../controller';
import { store, useStore } from '../store';
import { fmtTime } from '../util';
import { Panel } from './controls';
import { Icon } from './Icon';

export function MarkersPanel() {
  const markers = useStore((s) => s.markers);

  return (
    <Panel
      title="Markers & sections"
      actions={
        <>
          <button className="chip small" onClick={() => c.addMarker('marker')} title="Add marker (M)">+ Marker</button>
          <button className="chip small" onClick={() => c.addMarker('section')} title="Add section (Shift+M)">+ Section</button>
        </>
      }
    >
      {markers.length === 0 ? (
        <p className="hint">
          Press <kbd>M</kbd> while listening to drop markers on the beat, or <kbd>Shift+M</kbd> for sections (verse, chorus…). Jump with <kbd>1</kbd>–<kbd>9</kbd>.
        </p>
      ) : (
        <ul className="item-list markers">
          {markers.map((m, i) => (
            <li key={m.id}>
              <span className={`kind-dot ${m.kind}`} title={m.kind} />
              <span className="marker-index">{i < 9 ? i + 1 : ''}</span>
              <button className="time-link" onClick={() => c.seek(m.time)} title="Jump here">
                {fmtTime(m.time)}
              </button>
              <input className="inline-edit" value={m.label} placeholder="Add label…" onChange={(e) => c.renameMarker(m.id, e.target.value)} />
              <button className="chip tiny" onClick={() => c.loopFromMarker(m.id)} title="Loop from here to the next marker">
                <Icon name="loop" size={12} />
              </button>
              <button
                className="chip tiny"
                title={m.kind === 'section' ? 'Make plain marker' : 'Make section'}
                onClick={() =>
                  store.set((s) => ({ markers: s.markers.map((x) => (x.id === m.id ? { ...x, kind: x.kind === 'section' ? 'marker' : 'section' } : x)) }))
                }
              >
                {m.kind === 'section' ? 'S' : 'M'}
              </button>
              <button className="icon-btn small" onClick={() => c.deleteMarker(m.id)} title="Delete">
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {markers.length > 0 && (
        <button className="link-btn danger" onClick={() => window.confirm('Remove all markers?') && store.set({ markers: [] })}>
          Clear all
        </button>
      )}
    </Panel>
  );
}
