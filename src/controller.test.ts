// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as c from './controller';
import { initialState, store, type FileInfo } from './store';

// The engine owns an AudioContext and a WASM worklet; none of the logic under
// test needs either, only the playhead position it reports.
const engineMock = vi.hoisted(() => {
  const mock = {
    position: 0,
    seek: vi.fn((t: number) => {
      mock.position = t;
    }),
    getPosition: () => mock.position,
    pause: vi.fn(),
    toggle: vi.fn(),
    tapClick: vi.fn(),
    updateParams: vi.fn(),
    loopChanged: vi.fn(),
    chain: null,
    buffer: null,
  };
  return mock;
});

vi.mock('./audio/engine', () => ({ engine: engineMock }));

const FILE: FileInfo = {
  name: 'song.mp3',
  size: 1000,
  duration: 60,
  sampleRate: 44100,
  channels: 2,
  decoder: 'native',
  videoUrl: null,
};

/** Put the playhead somewhere and tell the store about it. */
const at = (t: number) => {
  engineMock.position = t;
};

beforeEach(() => {
  vi.clearAllMocks();
  engineMock.position = 0;
  store.set({ ...initialState(), file: FILE, view: { start: 0, end: 60 } });
});

describe('snap', () => {
  it('leaves times alone when snapping is off', () => {
    store.set({ snapToGrid: false, tempo: { bpm: 120, offset: 0, beatsPerBar: 4, detectedBpm: null } });
    expect(c.snap(1.234)).toBe(1.234);
  });

  it('snaps to the nearest beat when snapping is on', () => {
    store.set({ snapToGrid: true, tempo: { bpm: 120, offset: 0, beatsPerBar: 4, detectedBpm: null } });
    expect(c.snap(1.2)).toBeCloseTo(1, 6); // beats every 0.5 s
    expect(c.snap(1.3)).toBeCloseTo(1.5, 6);
  });

  it('snaps relative to the grid offset', () => {
    store.set({ snapToGrid: true, tempo: { bpm: 120, offset: 0.1, beatsPerBar: 4, detectedBpm: null } });
    expect(c.snap(1.2)).toBeCloseTo(1.1, 6);
  });
});

describe('view', () => {
  it('clamps a view to the file', () => {
    c.setView(-10, 100);
    expect(store.get().view).toEqual({ start: 0, end: 60 });
  });

  it('keeps a minimum width instead of collapsing', () => {
    c.setView(10, 10);
    const { start, end } = store.get().view;
    expect(end - start).toBeCloseTo(0.05, 6);
  });

  it('slides a too-late window back inside the file', () => {
    c.setView(59, 69);
    expect(store.get().view).toEqual({ start: 50, end: 60 });
  });

  it('zooms in around the playhead and back out again', () => {
    at(30);
    c.zoom(0.5);
    const zoomed = store.get().view;
    expect(zoomed.end - zoomed.start).toBeCloseTo(30, 6);
    expect((zoomed.start + zoomed.end) / 2).toBeCloseTo(30, 6);
    c.zoom(2);
    expect(store.get().view).toEqual({ start: 0, end: 60 });
  });

  it('holds a given point still while zooming around it', () => {
    // Zooming at the mouse: the point under the cursor keeps its position
    // across the view rather than jumping to the middle.
    c.zoom(0.5, 15); // 15 sits a quarter of the way into 0..60
    const { start, end } = store.get().view;
    expect(end - start).toBeCloseTo(30, 6);
    expect((15 - start) / (end - start)).toBeCloseTo(0.25, 6);
  });

  it('zooms to a range with a little padding', () => {
    c.zoomToRange(20, 30);
    const { start, end } = store.get().view;
    expect(start).toBeCloseTo(19.5, 6);
    expect(end).toBeCloseTo(30.5, 6);
  });

  it('toggles between the loop and the whole file', () => {
    c.setLoop(20, 30);
    c.zoomToLoopOrAll();
    expect(store.get().view.start).toBeCloseTo(19.5, 6);
    c.zoomToLoopOrAll();
    expect(store.get().view).toEqual({ start: 0, end: 60 });
  });

  it('does nothing without a file', () => {
    store.set({ file: null });
    c.setView(0, 10);
    expect(store.get().view).toEqual({ start: 0, end: 60 });
  });
});

describe('followPlayhead', () => {
  beforeEach(() => {
    store.set({ follow: true, playing: true, view: { start: 0, end: 10 } });
  });

  it('turns the page when the playhead reaches the right edge', () => {
    c.followPlayhead(9.9);
    const { start, end } = store.get().view;
    expect(start).toBeCloseTo(9.4, 6);
    expect(end - start).toBeCloseTo(10, 6);
  });

  it('jumps back when the playhead is behind the view', () => {
    store.set({ view: { start: 5, end: 15 } });
    c.followPlayhead(2);
    const { start, end } = store.get().view;
    expect(start).toBeCloseTo(1.5, 6);
    expect(end - start).toBeCloseTo(10, 6);
  });

  it('leaves the view alone mid-page', () => {
    c.followPlayhead(5);
    expect(store.get().view).toEqual({ start: 0, end: 10 });
  });

  it('does nothing when following is off or playback is stopped', () => {
    store.set({ follow: false });
    c.followPlayhead(9.9);
    expect(store.get().view).toEqual({ start: 0, end: 10 });
    store.set({ follow: true, playing: false });
    c.followPlayhead(9.9);
    expect(store.get().view).toEqual({ start: 0, end: 10 });
  });
});

describe('speed and pitch', () => {
  it('clamps the rate to the supported range', () => {
    c.setRate(0.5);
    expect(store.get().rate).toBe(0.5);
    c.setRate(99);
    expect(store.get().rate).toBe(4);
    c.setRate(0);
    expect(store.get().rate).toBe(0.05);
  });

  it('rounds the rate to a thousandth', () => {
    c.setRate(0.123456);
    expect(store.get().rate).toBe(0.123);
  });

  it('clamps transposition and fine tuning', () => {
    c.setSemitones(99);
    expect(store.get().semitones).toBe(24);
    c.setCents(-999);
    expect(store.get().cents).toBe(-100);
  });

  it('carries cents over into semitones', () => {
    c.setSemitones(0);
    c.setCents(90);
    c.nudgeCents(20);
    expect(store.get()).toMatchObject({ semitones: 1, cents: 10 });
  });

  it('stops carrying at the end of the range', () => {
    c.setSemitones(24);
    c.setCents(0);
    c.nudgeCents(50);
    expect(store.get()).toMatchObject({ semitones: 24, cents: 0 });
  });

  it('resets both at once', () => {
    c.setRate(0.5);
    c.setSemitones(3);
    c.setCents(20);
    c.resetSpeedPitch();
    expect(store.get()).toMatchObject({ rate: 1, semitones: 0, cents: 0 });
  });
});

describe('loops', () => {
  it('orders the edges however they are given', () => {
    c.setLoop(30, 10);
    expect(store.get().loop).toMatchObject({ start: 10, end: 30 });
  });

  it('clamps to the file and keeps a minimum length', () => {
    c.setLoop(-5, 999);
    expect(store.get().loop).toMatchObject({ start: 0, end: 60 });
    c.setLoop(10, 10);
    expect(store.get().loop.end).toBeCloseTo(10.02, 6);
  });

  it('nudges either edge without crossing the other', () => {
    c.setLoop(10, 20);
    c.nudgeLoop('start', 0.1);
    expect(store.get().loop.start).toBeCloseTo(10.1, 6);
    c.nudgeLoop('start', 100);
    expect(store.get().loop.start).toBeCloseTo(19.98, 6);
  });

  it('halves and doubles the loop, keeping the start', () => {
    c.setLoop(10, 20);
    c.scaleLoop(0.5);
    expect(store.get().loop).toMatchObject({ start: 10, end: 15 });
    c.scaleLoop(2);
    expect(store.get().loop).toMatchObject({ start: 10, end: 20 });
  });

  it('moves to the next phrase and follows with the playhead', () => {
    c.setLoop(10, 20);
    c.shiftLoop(1);
    expect(store.get().loop).toMatchObject({ start: 20, end: 30 });
    expect(engineMock.seek).toHaveBeenLastCalledWith(20);
    c.shiftLoop(-1);
    expect(store.get().loop).toMatchObject({ start: 10, end: 20 });
  });

  it('will not shift a loop off the end of the file', () => {
    c.setLoop(50, 60);
    c.shiftLoop(1);
    expect(store.get().loop).toMatchObject({ start: 50, end: 60 });
  });

  it('resets speed-trainer progress whenever the loop changes', () => {
    store.set({ trainer: { ...store.get().trainer, rep: 5 } });
    c.setLoop(10, 20);
    expect(store.get().trainer.rep).toBe(0);
  });

  describe('speed trainer', () => {
    beforeEach(() => {
      c.setLoop(10, 20);
      c.setTrainerEnabled(true);
    });

    it('starts at its start speed with the loop on', () => {
      expect(store.get().trainer.enabled).toBe(true);
      expect(store.get().rate).toBe(store.get().trainer.startRate);
      expect(store.get().loop.enabled).toBe(true);
    });

    it('stays on while it steps the speed itself', () => {
      store.set((s) => ({ rate: s.rate + 0.05, trainer: { ...s.trainer, rep: 0 } }));
      expect(store.get().trainer.enabled).toBe(true);
    });

    it('switches off when the speed is changed manually', () => {
      c.nudgeRate(0.05);
      expect(store.get().trainer.enabled).toBe(false);
    });

    it('switches off when the loop is turned off or moved', () => {
      c.toggleLoop();
      expect(store.get().trainer.enabled).toBe(false);
      c.toggleLoop();
      c.setTrainerEnabled(true);
      c.shiftLoop(1);
      expect(store.get().trainer.enabled).toBe(false);
    });

    it('switches off when seeking outside the loop, but not within it', () => {
      c.seek(15);
      expect(store.get().trainer.enabled).toBe(true);
      c.seek(40);
      expect(store.get().trainer.enabled).toBe(false);
    });
  });

  it('toggles a bar-long loop into existence at the playhead', () => {
    at(10);
    store.set({ tempo: { bpm: 120, offset: 0, beatsPerBar: 4, detectedBpm: null } });
    c.toggleLoop();
    expect(store.get().loop).toMatchObject({ enabled: true, start: 10, end: 12 });
    c.toggleLoop();
    expect(store.get().loop.enabled).toBe(false);
  });

  it('saves, recalls, renames and deletes loops', () => {
    c.setLoop(10, 20);
    c.saveCurrentLoop();
    const [saved] = store.get().loops;
    expect(saved).toMatchObject({ name: 'Loop 1', start: 10, end: 20 });

    c.setLoop(0, 5);
    c.recallLoop(saved.id);
    expect(store.get().loop).toMatchObject({ start: 10, end: 20, enabled: true });
    expect(engineMock.seek).toHaveBeenLastCalledWith(10);

    c.renameLoop(saved.id, 'Chorus');
    expect(store.get().loops[0].name).toBe('Chorus');
    c.deleteLoop(saved.id);
    expect(store.get().loops).toEqual([]);
  });

  it('refuses to save an empty loop', () => {
    c.saveCurrentLoop();
    expect(store.get().loops).toEqual([]);
  });
});

describe('markers', () => {
  it('keeps markers sorted by time', () => {
    c.addMarker(30);
    c.addMarker(10);
    c.addMarker(20);
    expect(store.get().markers.map((m) => m.time)).toEqual([10, 20, 30]);
  });

  it('rotates through the palette so neighbours differ', () => {
    for (let i = 0; i < 6; i++) c.addMarker(i);
    expect(new Set(store.get().markers.map((m) => m.color)).size).toBe(6);
  });

  it('snaps a new marker to the grid when snapping is on', () => {
    store.set({ snapToGrid: true, tempo: { bpm: 120, offset: 0, beatsPerBar: 4, detectedBpm: null } });
    c.addMarker(1.2);
    expect(store.get().markers[0].time).toBeCloseTo(1, 6);
  });

  it('re-sorts and clamps when a marker is dragged', () => {
    c.addMarker(10);
    c.addMarker(20);
    const [first] = store.get().markers;
    c.moveMarker(first.id, 30);
    expect(store.get().markers.map((m) => m.time)).toEqual([20, 30]);
    c.moveMarker(first.id, 999);
    expect(store.get().markers.map((m) => m.time)).toEqual([20, 60]);
  });

  it('renames, recolours and deletes', () => {
    c.addMarker(10);
    const [m] = store.get().markers;
    c.renameMarker(m.id, 'Solo');
    expect(store.get().markers[0].label).toBe('Solo');
    c.cycleMarkerColor(m.id);
    expect(store.get().markers[0].color).not.toBe(m.color);
    c.deleteMarker(m.id);
    expect(store.get().markers).toEqual([]);
  });

  it('jumps to a marker by index', () => {
    c.addMarker(10);
    c.addMarker(20);
    c.jumpToMarker(1);
    expect(engineMock.seek).toHaveBeenLastCalledWith(20);
    c.jumpToMarker(9); // nothing there
    expect(engineMock.seek).toHaveBeenCalledTimes(1);
  });

  it('walks forwards and backwards through markers', () => {
    c.addMarker(10);
    c.addMarker(20);
    at(0);
    c.jumpAdjacentMarker(1);
    expect(engineMock.position).toBe(10);
    c.jumpAdjacentMarker(1);
    expect(engineMock.position).toBe(20);
    c.jumpAdjacentMarker(1); // past the last one: to the end of the file
    expect(engineMock.position).toBe(60);
    c.jumpAdjacentMarker(-1);
    expect(engineMock.position).toBe(20);
  });

  it('loops from a marker to the next one', () => {
    c.addMarker(10);
    c.addMarker(20);
    const [first, second] = store.get().markers;
    c.loopFromMarker(first.id);
    expect(store.get().loop).toMatchObject({ start: 10, end: 20, enabled: true });
    c.loopFromMarker(second.id); // last marker: loop to the end of the file
    expect(store.get().loop).toMatchObject({ start: 20, end: 60 });
  });
});

describe('transport', () => {
  it('clamps seeks to the file', () => {
    c.seek(999);
    expect(engineMock.seek).toHaveBeenLastCalledWith(60);
    c.seek(-5);
    expect(engineMock.seek).toHaveBeenLastCalledWith(0);
  });

  it('remembers where playback would restart while stopped', () => {
    c.seek(12);
    expect(store.get().playStart).toBe(12);
    store.set({ playing: true });
    c.seek(30);
    expect(store.get().playStart).toBe(12);
  });

  it('seeks by whole bars', () => {
    store.set({ tempo: { bpm: 120, offset: 0, beatsPerBar: 4, detectedBpm: null } });
    at(10);
    c.seekBars(1);
    expect(engineMock.seek).toHaveBeenLastCalledWith(12);
    at(10);
    c.seekBars(-2);
    expect(engineMock.seek).toHaveBeenLastCalledWith(6);
  });
});

describe('tempo', () => {
  it('clamps the BPM to the range the UI offers', () => {
    c.setBpm(1);
    expect(store.get().tempo.bpm).toBe(20);
    c.setBpm(9999);
    expect(store.get().tempo.bpm).toBe(400);
  });

  it('puts the downbeat under the playhead', () => {
    store.set({ tempo: { bpm: 120, offset: 0, beatsPerBar: 4, detectedBpm: null } });
    at(10.3);
    c.setDownbeatHere();
    expect(store.get().tempo.offset).toBeCloseTo(0.3, 6);
    expect(store.get().gridVisible).toBe(true);
  });
});

describe('EQ presets', () => {
  it('all produce a full set of bands within the filter ranges', () => {
    for (const [name, preset] of Object.entries(c.EQ_PRESETS)) {
      const eq = preset(store.get().eq);
      expect(eq.bands, name).toHaveLength(6);
      for (const band of eq.bands) {
        expect(band.freq).toBeGreaterThanOrEqual(20);
        expect(band.freq).toBeLessThanOrEqual(20000);
        expect(Math.abs(band.gain)).toBeLessThanOrEqual(24);
        expect(band.q).toBeGreaterThan(0);
      }
      expect(eq.hpFreq).toBeGreaterThanOrEqual(20);
      expect(eq.lpFreq).toBeLessThanOrEqual(20000);
    }
  });

  it('does not share state between the preset and the store', () => {
    const eq = c.EQ_PRESETS.Flat(store.get().eq);
    eq.bands[0].gain = 12;
    expect(c.EQ_PRESETS.Flat(store.get().eq).bands[0].gain).toBe(0);
  });
});
