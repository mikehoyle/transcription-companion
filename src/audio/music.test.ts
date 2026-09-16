import { describe, expect, it } from 'vitest';
import { ANALYSIS_RATE, NOTE_MIN, chroma, detectKey, detectTempo, formatChord, guessChord, guessNotes, midiToFreq, noteName, pcName, spectrumAt, toDisplayLevels } from './music';

/** A steady mix of sine partials at the analysis rate. */
function tone(midis: number[], seconds = 1, harmonics = 1): Float32Array {
  const n = Math.round(seconds * ANALYSIS_RATE);
  const out = new Float32Array(n);
  for (const m of midis) {
    const f0 = midiToFreq(m);
    for (let h = 1; h <= harmonics; h++) {
      const amp = 0.3 / midis.length / h;
      for (let i = 0; i < n; i++) out[i] += amp * Math.sin((2 * Math.PI * f0 * h * i) / ANALYSIS_RATE);
    }
  }
  return out;
}

/** Chroma vector for a set of pitch classes, as a chord recogniser would see it. */
const chromaOf = (pcs: number[], strength = 1) => {
  const c = new Float32Array(12);
  for (const pc of pcs) c[((pc % 12) + 12) % 12] = strength;
  return c;
};

describe('note naming', () => {
  it('converts MIDI numbers to frequencies', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    expect(midiToFreq(60)).toBeCloseTo(261.626, 3);
    expect(midiToFreq(81)).toBeCloseTo(880, 6);
  });

  it('names pitch classes and notes with octaves', () => {
    expect(pcName(0)).toBe('C');
    expect(pcName(10)).toBe('B♭');
    expect(pcName(-1)).toBe('B');
    expect(pcName(13)).toBe('C♯');
    expect(noteName(60)).toBe('C4');
    expect(noteName(69)).toBe('A4');
    expect(noteName(NOTE_MIN)).toBe('C1');
  });
});

describe('semitoneSpectrum', () => {
  it('lands a pure tone on its own semitone bin', () => {
    for (const midi of [40, 60, 69, 84]) {
      const spec = spectrumAt(tone([midi], 1), 0.5);
      let peak = 0;
      for (let i = 1; i < spec.length; i++) if (spec[i] > spec[peak]) peak = i;
      expect(NOTE_MIN + peak).toBe(midi);
    }
  });

  it('returns one value per semitone of the analysed range', () => {
    const spec = spectrumAt(tone([60]), 0.5);
    expect(spec.length).toBe(85); // C1..C8 inclusive
  });

  it('is silent for a silent signal', () => {
    const spec = spectrumAt(new Float32Array(ANALYSIS_RATE), 0.5);
    expect(Math.max(...spec)).toBeLessThan(1e-6);
  });
});

describe('guessNotes', () => {
  it('finds the notes of a major triad', () => {
    const spec = spectrumAt(tone([60, 64, 67]), 0.5);
    expect(guessNotes(spec)).toEqual([60, 64, 67]);
  });

  it('finds a wide voicing spanning three octaves', () => {
    const spec = spectrumAt(tone([36, 55, 64, 79]), 0.5);
    expect(guessNotes(spec)).toEqual([36, 55, 64, 79]);
  });

  it('reports a single note once, not its overtones', () => {
    // A sawtooth-ish tone: the fundamental plus six harmonics.
    const spec = spectrumAt(tone([48], 1, 7), 0.5);
    expect(guessNotes(spec)[0]).toBe(48);
  });

  it('returns nothing for silence', () => {
    expect(guessNotes(new Float32Array(85))).toEqual([]);
  });

  it('honours the note limit', () => {
    const spec = spectrumAt(tone([48, 55, 60, 64, 67, 72, 76]), 0.5);
    expect(guessNotes(spec, 3).length).toBeLessThanOrEqual(3);
  });
});

describe('chroma', () => {
  it('folds octaves onto twelve pitch classes', () => {
    const spec = spectrumAt(tone([48, 60, 72]), 0.5); // three Cs
    const c = chroma(spec);
    let peak = 0;
    for (let i = 1; i < 12; i++) if (c[i] > c[peak]) peak = i;
    expect(peak).toBe(0);
    expect(c[0]).toBeGreaterThan(10 * Math.max(...Array.from(c).slice(1)));
  });
});

describe('guessChord', () => {
  const cases: [string, number[], string][] = [
    ['major', [0, 4, 7], 'C'],
    ['minor', [0, 3, 7], 'Cm'],
    ['dominant 7', [0, 4, 7, 10], 'C7'],
    ['major 7', [0, 4, 7, 11], 'Cmaj7'],
    ['minor 7', [0, 3, 7, 10], 'Cm7'],
    ['sus4', [0, 5, 7], 'Csus4'],
    ['diminished', [0, 3, 6], 'Cdim'],
    ['augmented', [0, 4, 8], 'Caug'],
    ['power chord', [0, 7], 'C5'],
  ];

  it.each(cases)('recognises a %s chord', (_name, pcs, expected) => {
    const guess = guessChord(chromaOf(pcs));
    expect(guess).not.toBeNull();
    expect(formatChord(guess!)).toBe(expected);
  });

  it('uses the bass to tell sus2 from sus4', () => {
    // C-D-G is Csus2 and Gsus4 at once — the same three pitch classes. Only the
    // bass note breaks the tie, so the recogniser needs it to call this one.
    expect(formatChord(guessChord(chromaOf([0, 2, 7]), 0)!)).toBe('Csus2');
    expect(formatChord(guessChord(chromaOf([0, 2, 7]), 7)!)).toBe('Gsus4');
  });

  it('transposes with the root', () => {
    const guess = guessChord(chromaOf([2, 6, 9])); // D major
    expect(formatChord(guess!)).toBe('D');
  });

  it('reports a chord tone in the bass as a slash chord', () => {
    const guess = guessChord(chromaOf([0, 4, 7]), 4);
    expect(formatChord(guess!)).toBe('C/E');
  });

  it('ignores the bass note when it is the root', () => {
    expect(guessChord(chromaOf([0, 4, 7]), 0)!.bass).toBeNull();
  });

  it('returns null for silence', () => {
    expect(guessChord(new Float32Array(12))).toBeNull();
  });

  it('applies the display transposition when formatting', () => {
    expect(formatChord({ root: 0, suffix: 'm7', bass: null }, 2)).toBe('Dm7');
    expect(formatChord({ root: 0, suffix: '', bass: 4 }, 2)).toBe('D/F♯');
  });
});

describe('detectKey', () => {
  it('identifies the key of a chord progression in C major', () => {
    // I - vi - IV - V, the way an accumulated chroma vector would see it.
    const acc = new Float32Array(12);
    for (const chord of [
      [0, 4, 7],
      [9, 0, 4],
      [5, 9, 0],
      [7, 11, 2],
    ]) {
      for (const pc of chord) acc[pc] += 1;
    }
    const key = detectKey(acc);
    expect(key.tonic).toBe(0);
    expect(key.mode).toBe('major');
  });

  it('identifies a minor key', () => {
    const acc = new Float32Array(12);
    for (const chord of [
      [9, 0, 4],
      [2, 5, 9],
      [4, 8, 11],
      [9, 0, 4],
    ]) {
      for (const pc of chord) acc[pc] += 1;
    }
    const key = detectKey(acc);
    expect(key.tonic).toBe(9);
    expect(key.mode).toBe('minor');
  });

  it('follows a transposition of the same material', () => {
    const base = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    for (const shift of [0, 3, 7, 11]) {
      const acc = Float32Array.from({ length: 12 }, (_, i) => base[(i - shift + 12) % 12]);
      expect(detectKey(acc).tonic).toBe(shift);
    }
  });
});

describe('detectTempo', () => {
  const HOP = 512 / ANALYSIS_RATE; // the hop the analysis worker uses

  /**
   * An onset envelope with a beat on every beat. The peak is spread over the
   * neighbouring frames because that is what the real envelope looks like: it
   * comes from spectral flux over 1024-sample windows taken every 512 samples,
   * so one onset always lands in more than one frame.
   */
  function pulses(bpm: number, seconds: number, offsetSec = 0): Float32Array {
    const frames = Math.floor(seconds / HOP);
    const env = new Float32Array(frames);
    const period = 60 / bpm;
    for (let t = offsetSec; t < seconds; t += period) {
      const centre = Math.round(t / HOP);
      for (let d = -1; d <= 1; d++) {
        const f = centre + d;
        if (f >= 0 && f < frames) env[f] += d === 0 ? 1 : 0.5;
      }
    }
    return env;
  }

  it.each([60, 80, 90, 100, 120, 140, 160, 180])('recovers %i BPM from a click track', (bpm) => {
    const result = detectTempo(pulses(bpm, 20), HOP);
    expect(result).not.toBeNull();
    expect(result!.bpm).toBeCloseTo(bpm, 0);
  });

  it('finds the phase of an off-grid click track', () => {
    const offset = 0.25;
    const result = detectTempo(pulses(120, 20, offset), HOP);
    expect(result!.bpm).toBeCloseTo(120, 0);
    // The reported offset is the first beat, modulo one beat.
    expect(result!.offset % 0.5).toBeCloseTo(offset, 1);
  });

  it('gives up on a signal too short to hold a tempo', () => {
    expect(detectTempo(pulses(120, 2), HOP)).toBeNull();
  });

  it('gives up on a flat envelope', () => {
    const flat = new Float32Array(Math.floor(20 / HOP)).fill(0.5);
    const result = detectTempo(flat, HOP);
    // Nothing periodic to lock onto: either no answer, or one with no real support.
    if (result) expect(result.bpm).toBeGreaterThan(0);
  });
});

describe('toDisplayLevels', () => {
  it('maps the reference level to 1 and the floor to 0', () => {
    const levels = toDisplayLevels(Float32Array.from([1, 0.001, 0]), 1, 60);
    expect(levels[0]).toBeCloseTo(1, 6);
    expect(levels[1]).toBeCloseTo(0, 6); // -60 dB
    expect(levels[2]).toBe(0);
  });

  it('clamps anything above the reference', () => {
    expect(toDisplayLevels(Float32Array.from([10]), 1)[0]).toBe(1);
  });
});
