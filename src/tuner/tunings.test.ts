import { describe, expect, it } from 'vitest';
import {
  A4_DEFAULT,
  DEFAULT_SETTINGS,
  MIDI_MAX,
  MIDI_MIN,
  OFFSET_LIMIT,
  TUNINGS,
  centsBetween,
  freqOf,
  ordinal,
  parseSettings,
  soundingMidi,
  stringNumber,
  tuningById,
} from './tunings';

/** Both spellings of each pitch class, for checking a tuning's notes against its name. */
const PITCH_CLASS: Record<string, number> = {
  C: 0,
  'C♯': 1,
  'D♭': 1,
  D: 2,
  'D♯': 3,
  'E♭': 3,
  E: 4,
  F: 5,
  'F♯': 6,
  'G♭': 6,
  G: 7,
  'G♯': 8,
  'A♭': 8,
  A: 9,
  'A♯': 10,
  'B♭': 10,
  B: 11,
};

describe('pitch', () => {
  it('puts A4 at the reference and the octaves either side of it', () => {
    expect(freqOf(69)).toBe(440);
    expect(freqOf(57)).toBeCloseTo(220, 10);
    expect(freqOf(81)).toBeCloseTo(880, 10);
  });

  it('tunes the whole scale from A4', () => {
    expect(freqOf(69, 432)).toBe(432);
    expect(freqOf(40, 440)).toBeCloseTo(82.4069, 3); // low E on a guitar
    expect(freqOf(40, 442) / freqOf(40, 440)).toBeCloseTo(442 / 440, 10);
  });

  it('measures intervals in cents', () => {
    expect(centsBetween(880, 440)).toBeCloseTo(1200, 10);
    expect(centsBetween(freqOf(70), freqOf(69))).toBeCloseTo(100, 10);
    expect(centsBetween(442, 440)).toBeCloseTo(7.85, 2);
  });
});

describe('tunings', () => {
  it('has unique ids', () => {
    expect(new Set(TUNINGS.map((t) => t.id)).size).toBe(TUNINGS.length);
  });

  it('keeps every string in audible range', () => {
    for (const t of TUNINGS) {
      expect(t.notes.length).toBeGreaterThan(0);
      for (const n of t.notes) {
        expect(n).toBeGreaterThanOrEqual(MIDI_MIN);
        expect(n).toBeLessThanOrEqual(MIDI_MAX);
      }
    }
  });

  // The note letters in a preset's name are what a player will check it against, so a
  // mistyped MIDI number should fail here rather than quietly sound the wrong pitch.
  it('sounds the notes its name promises', () => {
    for (const t of TUNINGS) {
      const written = /\(([^)]+)\)/.exec(t.name)?.[1];
      expect(written, `${t.name} should spell its notes out`).toBeDefined();
      const tokens = written!.split(/\s+/);
      expect(tokens, t.name).toHaveLength(t.notes.length);
      tokens.forEach((token, i) => {
        const pc = PITCH_CLASS[token.toUpperCase()];
        expect(pc, `${t.name}: ${token}`).toBeDefined();
        expect(t.notes[i] % 12, `${t.name}: ${token}`).toBe(pc);
      });
    }
  });

  it('numbers strings the way players do', () => {
    const guitar = tuningById('guitar-standard');
    expect(stringNumber(guitar, 0)).toBe(6); // low E is the 6th
    expect(stringNumber(guitar, 5)).toBe(1); // high E is the 1st
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
  });

  it('falls back to the default for an unknown id', () => {
    expect(tuningById('nope').id).toBe(TUNINGS[0].id);
  });

  it('is re-entrant where it should be', () => {
    // The ukulele's 4th string sounds above its 3rd; the banjo's 5th above everything.
    const uke = tuningById('uke-soprano');
    expect(uke.notes[0]).toBeGreaterThan(uke.notes[1]);
    const banjo = tuningById('banjo-open-g');
    expect(Math.max(...banjo.notes)).toBe(banjo.notes[0]);
  });
});

describe('soundingMidi', () => {
  const guitar = tuningById('guitar-standard');

  it('is the preset note when nothing is changed', () => {
    expect(soundingMidi(guitar, 0, { offsets: [], octave: 0 })).toBe(40);
  });

  it('applies the string tweak and the octave shift', () => {
    expect(soundingMidi(guitar, 0, { offsets: [-2], octave: 0 })).toBe(38);
    expect(soundingMidi(guitar, 0, { offsets: [], octave: 1 })).toBe(52);
    expect(soundingMidi(guitar, 0, { offsets: [-2], octave: 2 })).toBe(62);
  });

  it('clamps rather than sounding something inaudible', () => {
    const bass5 = tuningById('bass-5');
    expect(soundingMidi(bass5, 0, { offsets: [], octave: -2 })).toBe(MIDI_MIN); // B0 - 2 octaves
    const violin = tuningById('violin');
    expect(soundingMidi(violin, 3, { offsets: [0, 0, 0, OFFSET_LIMIT], octave: 2 })).toBe(MIDI_MAX); // E5 + an octave + 2
  });
});

describe('parseSettings', () => {
  it('returns the defaults for junk', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings([1, 2, 3])).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values', () => {
    // Deliberately none of the defaults, so this proves the values came from the input.
    const input = { tuningId: 'cello', octave: 1, a4: 442, timbre: 'pure', mode: 'drone', volume: 0.8, autoRepeat: false, repeatSec: 6, refMidi: 60 };
    expect(parseSettings(input)).toMatchObject(input);
  });

  it('drops out-of-range and wrong-typed fields', () => {
    const s = parseSettings({ tuningId: 42, octave: 9, a4: 1000, timbre: 'brass', mode: '', volume: -1, autoRepeat: 'yes', repeatSec: 'x', refMidi: 999 });
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('resizes the offsets to the tuning it was saved with', () => {
    // Four-string tuning, six saved offsets: the extras go, the rest stay.
    expect(parseSettings({ tuningId: 'violin', offsets: [1, 0, -1, 2, 5, 5] }).offsets).toEqual([1, 0, -1, 2]);
    // Too few, and the missing strings sit at the preset pitch.
    expect(parseSettings({ tuningId: 'violin', offsets: [1] }).offsets).toEqual([1, 0, 0, 0]);
    // A nonsense entry doesn't shift the strings after it.
    expect(parseSettings({ tuningId: 'violin', offsets: [1, 'x', 99, -2] }).offsets).toEqual([1, 0, 0, -2]);
    expect(parseSettings({ tuningId: 'violin', offsets: [OFFSET_LIMIT + 1] }).offsets[0]).toBe(0);
  });

  it('defaults A4 to concert pitch', () => {
    expect(parseSettings({}).a4).toBe(A4_DEFAULT);
  });
});
