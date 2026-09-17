// Tuning presets and the pure maths behind the tuner page. Kept free of React and of
// Web Audio so it can be unit-tested, and so the page can be pre-rendered at build time.

export type Timbre = 'pure' | 'soft' | 'rich';
export type PlayMode = 'drone' | 'pluck';

export interface Tuning {
  id: string;
  /** Instrument family, used for the <optgroup> labels. */
  group: string;
  name: string;
  /**
   * MIDI notes in *string order*, starting at the highest-numbered string — the 6th (low E)
   * on a guitar, the 5th (the short drone) on a banjo. That is the order tunings are
   * conventionally written in, and it is not always pitch order: a re-entrant ukulele's
   * 4th string sounds above its 3rd.
   */
  notes: number[];
  /** Shown under the name; for anything worth a word of explanation. */
  note?: string;
}

// MIDI reference: C4 = 60, A4 = 69.
export const TUNINGS: Tuning[] = [
  { id: 'guitar-standard', group: 'Guitar', name: 'Standard (E A D G B E)', notes: [40, 45, 50, 55, 59, 64] },
  { id: 'guitar-drop-d', group: 'Guitar', name: 'Drop D (D A D G B E)', notes: [38, 45, 50, 55, 59, 64] },
  { id: 'guitar-eb', group: 'Guitar', name: 'Half step down (E♭ A♭ D♭ G♭ B♭ E♭)', notes: [39, 44, 49, 54, 58, 63] },
  { id: 'guitar-d', group: 'Guitar', name: 'Whole step down (D G C F A D)', notes: [38, 43, 48, 53, 57, 62] },
  { id: 'guitar-dadgad', group: 'Guitar', name: 'DADGAD (D A D G A D)', notes: [38, 45, 50, 55, 57, 62] },
  { id: 'guitar-open-d', group: 'Guitar', name: 'Open D (D A D F♯ A D)', notes: [38, 45, 50, 54, 57, 62] },
  { id: 'guitar-open-g', group: 'Guitar', name: 'Open G (D G D G B D)', notes: [38, 43, 50, 55, 59, 62] },
  { id: 'guitar-open-e', group: 'Guitar', name: 'Open E (E B E G♯ B E)', notes: [40, 47, 52, 56, 59, 64] },
  { id: 'guitar-open-c', group: 'Guitar', name: 'Open C (C G C G C E)', notes: [36, 43, 48, 55, 60, 64] },
  { id: 'guitar-7', group: 'Guitar', name: '7-string (B E A D G B E)', notes: [35, 40, 45, 50, 55, 59, 64] },
  { id: 'guitar-baritone', group: 'Guitar', name: 'Baritone (B E A D F♯ B)', notes: [35, 40, 45, 50, 54, 59] },

  { id: 'bass-4', group: 'Bass', name: '4-string (E A D G)', notes: [28, 33, 38, 43] },
  { id: 'bass-5', group: 'Bass', name: '5-string (B E A D G)', notes: [23, 28, 33, 38, 43] },
  { id: 'bass-6', group: 'Bass', name: '6-string (B E A D G C)', notes: [23, 28, 33, 38, 43, 48] },
  { id: 'bass-drop-d', group: 'Bass', name: 'Drop D (D A D G)', notes: [26, 33, 38, 43] },

  { id: 'uke-soprano', group: 'Ukulele', name: 'Soprano / concert / tenor (g C E A)', notes: [67, 60, 64, 69], note: 'Re-entrant: the 4th string sounds above the 3rd.' },
  { id: 'uke-low-g', group: 'Ukulele', name: 'Low G (G C E A)', notes: [55, 60, 64, 69] },
  { id: 'uke-baritone', group: 'Ukulele', name: 'Baritone (D G B E)', notes: [50, 55, 59, 64] },

  { id: 'violin', group: 'Bowed strings', name: 'Violin (G D A E)', notes: [55, 62, 69, 76] },
  { id: 'viola', group: 'Bowed strings', name: 'Viola (C G D A)', notes: [48, 55, 62, 69] },
  { id: 'cello', group: 'Bowed strings', name: 'Cello (C G D A)', notes: [36, 43, 50, 57] },
  { id: 'double-bass', group: 'Bowed strings', name: 'Double bass (E A D G)', notes: [28, 33, 38, 43] },

  { id: 'mandolin', group: 'Mandolin & banjo', name: 'Mandolin (G D A E)', notes: [55, 62, 69, 76], note: 'Tune both strings of each course to the same pitch.' },
  { id: 'mandola', group: 'Mandolin & banjo', name: 'Mandola (C G D A)', notes: [48, 55, 62, 69] },
  { id: 'banjo-open-g', group: 'Mandolin & banjo', name: 'Banjo, open G (g D G B D)', notes: [67, 50, 55, 59, 62], note: 'The 5th string is the short drone; it sounds highest.' },
  { id: 'banjo-double-c', group: 'Mandolin & banjo', name: 'Banjo, double C (g C G C D)', notes: [67, 48, 55, 60, 62] },
  { id: 'banjo-tenor', group: 'Mandolin & banjo', name: 'Tenor banjo (C G D A)', notes: [48, 55, 62, 69] },
];

export const DEFAULT_TUNING = TUNINGS[0];

export const tuningById = (id: string) => TUNINGS.find((t) => t.id === id) ?? DEFAULT_TUNING;

/**
 * String number as players count them: the 1st string is the last one listed (the highest
 * on a guitar), the 6th is the first.
 */
export const stringNumber = (tuning: Tuning, index: number) => tuning.notes.length - index;

/** "1st", "2nd", "3rd"… */
export const ordinal = (n: number) => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen || n % 10 > 3 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10];
  return `${n}${suffix}`;
};

// ------------------------------------------------------------ pitch

/** Lowest and highest MIDI notes the tuner will sound, after octave shift and tweaks. */
export const MIDI_MIN = 12; // C0, 16 Hz
export const MIDI_MAX = 108; // C8, 4186 Hz

/** A4 range: a semitone either side of 440 covers baroque pitch (415) up to 466. */
export const A4_MIN = 415;
export const A4_MAX = 466;
export const A4_DEFAULT = 440;

/** Equal-temperament frequency of a MIDI note, with a movable A4. */
export const freqOf = (midi: number, a4: number = A4_DEFAULT) => a4 * 2 ** ((midi - 69) / 12);

/** Interval between two frequencies in cents. */
export const centsBetween = (freq: number, ref: number) => 1200 * Math.log2(freq / ref);

export const fmtHz = (f: number) => (f >= 1000 ? f.toFixed(1) : f.toFixed(2));

/** The MIDI note a string actually sounds, after the octave shift and any per-string tweak. */
export const soundingMidi = (tuning: Tuning, index: number, settings: Pick<TunerSettings, 'offsets' | 'octave'>) =>
  clampMidi(tuning.notes[index] + (settings.offsets[index] ?? 0) + settings.octave * 12);

export const clampMidi = (m: number) => Math.max(MIDI_MIN, Math.min(MIDI_MAX, m));

// ------------------------------------------------------------ settings

export interface TunerSettings {
  tuningId: string;
  /** Per-string semitone tweaks on top of the preset, parallel to the tuning's `notes`. */
  offsets: number[];
  /** Whole-instrument octave shift. Small speakers can't reproduce a low B; +1 or +2 can. */
  octave: number;
  a4: number;
  timbre: Timbre;
  mode: PlayMode;
  volume: number;
  /** Sound the current string again and again, hands-free. */
  autoRepeat: boolean;
  /** Seconds between repeats when auto-repeat is on. */
  repeatSec: number;
  /** MIDI note of the free reference pitch (the chromatic row). */
  refMidi: number;
}

export const DEFAULT_SETTINGS: TunerSettings = {
  tuningId: DEFAULT_TUNING.id,
  offsets: [],
  octave: 0,
  a4: A4_DEFAULT,
  timbre: 'rich',
  mode: 'pluck',
  volume: 0.5,
  autoRepeat: true,
  repeatSec: 4,
  refMidi: 69,
};

export const OCTAVE_MIN = -2;
export const OCTAVE_MAX = 2;
export const OFFSET_LIMIT = 12;
export const REPEAT_MIN = 1;
export const REPEAT_MAX = 20;

const TIMBRES: readonly Timbre[] = ['pure', 'soft', 'rich'];
const MODES: readonly PlayMode[] = ['drone', 'pluck'];

const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);

const num = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined);

const int = (v: unknown, min: number, max: number) => {
  const n = num(v, min, max);
  return n === undefined ? undefined : Math.round(n);
};

/**
 * Settings come back from localStorage, where an older version of this page — or anything
 * else — may have written them, so every field is checked and bad ones fall back to the
 * default rather than reaching the oscillator.
 */
export function parseSettings(raw: unknown): TunerSettings {
  const s = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const tuning = typeof s.tuningId === 'string' ? TUNINGS.find((t) => t.id === s.tuningId) : undefined;
  const saved: unknown[] = Array.isArray(s.offsets) ? s.offsets : [];
  const offsets = saved.length ? (tuning ?? DEFAULT_TUNING).notes.map((_, i) => int(saved[i], -OFFSET_LIMIT, OFFSET_LIMIT) ?? 0) : [];
  return {
    tuningId: tuning?.id ?? DEFAULT_SETTINGS.tuningId,
    offsets,
    octave: int(s.octave, OCTAVE_MIN, OCTAVE_MAX) ?? DEFAULT_SETTINGS.octave,
    a4: num(s.a4, A4_MIN, A4_MAX) ?? DEFAULT_SETTINGS.a4,
    timbre: TIMBRES.includes(s.timbre as Timbre) ? (s.timbre as Timbre) : DEFAULT_SETTINGS.timbre,
    mode: MODES.includes(s.mode as PlayMode) ? (s.mode as PlayMode) : DEFAULT_SETTINGS.mode,
    volume: num(s.volume, 0, 1) ?? DEFAULT_SETTINGS.volume,
    autoRepeat: bool(s.autoRepeat) ?? DEFAULT_SETTINGS.autoRepeat,
    repeatSec: num(s.repeatSec, REPEAT_MIN, REPEAT_MAX) ?? DEFAULT_SETTINGS.repeatSec,
    refMidi: int(s.refMidi, MIDI_MIN, MIDI_MAX) ?? DEFAULT_SETTINGS.refMidi,
  };
}

export const SETTINGS_KEY = 'lbe.tuner.v1';

export function loadSettings(): TunerSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? parseSettings(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: TunerSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Private-browsing or a full quota: the tuner works fine without persistence.
  }
}
