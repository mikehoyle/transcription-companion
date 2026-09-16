// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { barBeat, clamp, fmtBytes, fmtFreq, fmtPct, fmtTime, isTextInput, parseTime } from './util';

describe('clamp', () => {
  it('keeps a value inside its range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it('returns the bound when the range is empty', () => {
    expect(clamp(5, 10, 0)).toBe(0);
  });
});

describe('fmtTime', () => {
  it('formats minutes and seconds', () => {
    expect(fmtTime(0)).toBe('0:00.00');
    expect(fmtTime(83.456)).toBe('1:23.46');
  });

  it('rolls over instead of showing a full minute of seconds', () => {
    expect(fmtTime(59.999)).toBe('1:00.00');
    expect(fmtTime(59.996, 2)).toBe('1:00.00');
    expect(fmtTime(59.994, 2)).toBe('0:59.99');
    expect(fmtTime(59.6, 0)).toBe('1:00');
    expect(fmtTime(119.999)).toBe('2:00.00');
    expect(fmtTime(3599.999)).toBe('1:00:00.00');
    expect(fmtTime(-59.999)).toBe('-1:00.00');
  });

  it('shows hours only when there are any', () => {
    expect(fmtTime(3600)).toBe('1:00:00.00');
    expect(fmtTime(3599)).toBe('59:59.00');
  });

  it('honours the decimal count', () => {
    expect(fmtTime(83.456, 0)).toBe('1:23');
    expect(fmtTime(83.456, 1)).toBe('1:23.5');
    expect(fmtTime(83.456, 3)).toBe('1:23.456');
  });

  it('handles negative and non-finite input', () => {
    expect(fmtTime(-5)).toBe('-0:05.00');
    expect(fmtTime(NaN)).toBe('0:00.00');
    expect(fmtTime(Infinity)).toBe('0:00.00');
  });
});

describe('parseTime', () => {
  it('parses the formats the app displays', () => {
    expect(parseTime('83.4')).toBeCloseTo(83.4);
    expect(parseTime('1:23.4')).toBeCloseTo(83.4);
    expect(parseTime('1:02:03')).toBe(3723);
    expect(parseTime('  1:23  ')).toBe(83);
  });

  it('round-trips with fmtTime', () => {
    for (const sec of [0, 12.34, 83.456, 3723.5]) {
      expect(parseTime(fmtTime(sec, 3))).toBeCloseTo(sec, 3);
    }
  });

  it('rejects anything it cannot read', () => {
    for (const text of ['', 'abc', '1:', ':30', '1::2', '1:2:3:4x']) {
      expect(parseTime(text)).toBeNull();
    }
  });
});

describe('barBeat', () => {
  it('counts bars and beats from the downbeat', () => {
    expect(barBeat(0, 120, 0, 4)).toBe('1.1');
    expect(barBeat(0.5, 120, 0, 4)).toBe('1.2');
    expect(barBeat(2, 120, 0, 4)).toBe('2.1');
    expect(barBeat(2.5, 120, 0, 4)).toBe('2.2');
  });

  it('follows the grid offset', () => {
    expect(barBeat(0.25, 120, 0.25, 4)).toBe('1.1');
    expect(barBeat(0.75, 120, 0.25, 4)).toBe('1.2');
  });

  it('follows the bar length', () => {
    expect(barBeat(1.5, 120, 0, 3)).toBe('2.1');
    expect(barBeat(3, 120, 0, 6)).toBe('2.1');
  });

  it('stays positive before the downbeat', () => {
    expect(barBeat(-0.5, 120, 0, 4)).toBe('0.4');
  });

  it('is not thrown off by floating-point beat boundaries', () => {
    // 0.1 s beats: 0.3 must read as beat 4, not beat 3.
    expect(barBeat(0.3, 600, 0, 4)).toBe('1.4');
  });
});

describe('formatting helpers', () => {
  it('formats playback rates as percentages', () => {
    expect(fmtPct(1)).toBe('100%');
    expect(fmtPct(0.755)).toBe('76%');
  });

  it('formats frequencies compactly', () => {
    expect(fmtFreq(80)).toBe('80');
    expect(fmtFreq(999.6)).toBe('1000');
    expect(fmtFreq(1000)).toBe('1.0k');
    expect(fmtFreq(2500)).toBe('2.5k');
    expect(fmtFreq(12000)).toBe('12k');
  });

  it('formats file sizes', () => {
    expect(fmtBytes(512)).toBe('512 B');
    expect(fmtBytes(2048)).toBe('2 KB');
    expect(fmtBytes(5 * 1024 ** 2)).toBe('5.0 MB');
  });
});

describe('isTextInput', () => {
  const el = (tag: string, type?: string) => {
    const node = document.createElement(tag);
    if (type) (node as HTMLInputElement).type = type;
    return node;
  };

  it('recognises fields that should swallow keystrokes', () => {
    expect(isTextInput(el('input', 'text'))).toBe(true);
    expect(isTextInput(el('input', 'number'))).toBe(true);
    expect(isTextInput(el('textarea'))).toBe(true);
    expect(isTextInput(el('select'))).toBe(true);
  });

  it('lets shortcuts through on controls that are not text fields', () => {
    expect(isTextInput(el('input', 'range'))).toBe(false);
    expect(isTextInput(el('input', 'checkbox'))).toBe(false);
    expect(isTextInput(el('input', 'radio'))).toBe(false);
    expect(isTextInput(el('input', 'button'))).toBe(false);
    expect(isTextInput(el('button'))).toBe(false);
    expect(isTextInput(el('canvas'))).toBe(false);
    expect(isTextInput(null)).toBe(false);
  });

  it('recognises a contenteditable element', () => {
    const div = el('div');
    // jsdom doesn't implement isContentEditable, so set it directly.
    Object.defineProperty(div, 'isContentEditable', { value: true });
    expect(isTextInput(div)).toBe(true);
  });
});
