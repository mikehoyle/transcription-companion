import { describe, expect, it } from 'vitest';
import { encodeWav } from './wav';

const read = async (blob: Blob) => new DataView(await blob.arrayBuffer());
const str = (v: DataView, off: number, len: number) => String.fromCharCode(...Array.from({ length: len }, (_, i) => v.getUint8(off + i)));

describe('encodeWav', () => {
  it('writes a RIFF/WAVE header describing the data that follows', async () => {
    const frames = 100;
    const v = await read(encodeWav([new Float32Array(frames), new Float32Array(frames)], 44100));
    expect(str(v, 0, 4)).toBe('RIFF');
    expect(str(v, 8, 4)).toBe('WAVE');
    expect(str(v, 12, 4)).toBe('fmt ');
    expect(str(v, 36, 4)).toBe('data');
    expect(v.getUint32(16, true)).toBe(16); // PCM fmt chunk size
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(2); // channels
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint16(34, true)).toBe(16); // bits per sample

    const dataSize = frames * 2 * 2;
    expect(v.getUint32(40, true)).toBe(dataSize);
    expect(v.getUint32(4, true)).toBe(36 + dataSize);
    expect(v.byteLength).toBe(44 + dataSize);
    expect(v.getUint32(28, true)).toBe(44100 * 2 * 2); // byte rate
    expect(v.getUint16(32, true)).toBe(4); // block align
  });

  it('describes a mono file correctly', async () => {
    const v = await read(encodeWav([new Float32Array(10)], 22050));
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(22050);
    expect(v.getUint32(28, true)).toBe(22050 * 2);
    expect(v.byteLength).toBe(44 + 20);
  });

  it('interleaves channels sample by sample', async () => {
    const left = Float32Array.from([1, 1, 1]);
    const right = Float32Array.from([-1, -1, -1]);
    const v = await read(encodeWav([left, right], 8000));
    for (let i = 0; i < 3; i++) {
      expect(v.getInt16(44 + i * 4, true)).toBe(32767);
      expect(v.getInt16(44 + i * 4 + 2, true)).toBe(-32768);
    }
  });

  it('converts floats to 16-bit PCM without clipping the full-scale values', async () => {
    const v = await read(encodeWav([Float32Array.from([0, 0.5, -0.5, 1, -1])], 8000));
    expect(v.getInt16(44, true)).toBe(0);
    expect(v.getInt16(46, true)).toBe(Math.round(0.5 * 32767));
    expect(v.getInt16(48, true)).toBe(-16384);
    expect(v.getInt16(50, true)).toBe(32767);
    expect(v.getInt16(52, true)).toBe(-32768);
  });

  it('rounds to the nearest step rather than towards zero', async () => {
    // Truncating would bias every sample towards silence by up to one LSB.
    const scale = 32767;
    const v = await read(encodeWav([Float32Array.from([0.5, 1.4 / scale, 0.6 / scale, -1.4 / scale])], 8000));
    expect(v.getInt16(44, true)).toBe(16384); // 16383.5 rounds up
    expect(v.getInt16(46, true)).toBe(1);
    expect(v.getInt16(48, true)).toBe(1);
    expect(v.getInt16(50, true)).toBe(-1);
  });

  it('clamps samples that overshoot instead of wrapping around', async () => {
    const v = await read(encodeWav([Float32Array.from([4, -4])], 8000));
    expect(v.getInt16(44, true)).toBe(32767);
    expect(v.getInt16(46, true)).toBe(-32768);
  });

  it('is typed as audio/wav', () => {
    expect(encodeWav([new Float32Array(4)], 8000).type).toBe('audio/wav');
  });
});
