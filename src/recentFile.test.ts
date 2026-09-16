import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetRecentFile, loadRecentFile, RECENT_FILE_MAX_BYTES, saveRecentFile } from './recentFile';

const BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]);

const makeFile = (name = 'song.wav', bytes = BYTES) =>
  new File([bytes], name, { type: 'audio/wav', lastModified: 1_700_000_000_000 });

/** A file that claims to be huge without allocating it. */
const oversized = (name = 'huge.wav') => {
  const file = makeFile(name);
  Object.defineProperty(file, 'size', { value: RECENT_FILE_MAX_BYTES + 1 });
  return file;
};

const bytesOf = async (file: File) => new Uint8Array(await file.arrayBuffer());

beforeEach(async () => {
  vi.unstubAllGlobals();
  await forgetRecentFile();
});

describe('recentFile', () => {
  it('has nothing to offer on a first visit', async () => {
    expect(await loadRecentFile()).toBeNull();
  });

  it('gives back a file that survives a round trip', async () => {
    const original = makeFile();
    await saveRecentFile(original);

    const restored = await loadRecentFile();
    expect(restored).toBeInstanceOf(File);
    expect(restored!.name).toBe(original.name);
    expect(restored!.type).toBe(original.type);
    expect(restored!.lastModified).toBe(original.lastModified);
    expect(restored!.size).toBe(original.size);
    expect(await bytesOf(restored!)).toEqual(BYTES);
  });

  it('survives being read twice, so a reload can reopen it again', async () => {
    await saveRecentFile(makeFile());
    expect((await loadRecentFile())!.name).toBe('song.wav');
    expect((await loadRecentFile())!.name).toBe('song.wav');
  });

  it('remembers only the most recent file', async () => {
    await saveRecentFile(makeFile('first.wav'));
    await saveRecentFile(makeFile('second.wav', new Uint8Array([9, 9])));

    const restored = await loadRecentFile();
    expect(restored!.name).toBe('second.wav');
    expect(await bytesOf(restored!)).toEqual(new Uint8Array([9, 9]));
  });

  it('forgets on request', async () => {
    await saveRecentFile(makeFile());
    await forgetRecentFile();
    expect(await loadRecentFile()).toBeNull();
  });

  it('forgetting nothing is not an error', async () => {
    await expect(forgetRecentFile()).resolves.toBeUndefined();
  });

  describe('files too big to keep', () => {
    it('are not stored', async () => {
      await saveRecentFile(oversized());
      expect(await loadRecentFile()).toBeNull();
    });

    it('replace the previous file with nothing, rather than leaving it behind', async () => {
      // Otherwise opening a big file would reopen the *older* one next visit.
      await saveRecentFile(makeFile('small.wav'));
      await saveRecentFile(oversized());
      expect(await loadRecentFile()).toBeNull();
    });

    it('keeps a file exactly on the limit', async () => {
      const file = makeFile();
      Object.defineProperty(file, 'size', { value: RECENT_FILE_MAX_BYTES });
      await saveRecentFile(file);
      expect(await loadRecentFile()).not.toBeNull();
    });
  });

  // Remembering the last file is a convenience; storage can be full, blocked by
  // the browser, or disabled in a private window. None of that should surface.
  describe('when IndexedDB is unavailable', () => {
    const broken = {
      open: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    };

    it('saving fails quietly', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.stubGlobal('indexedDB', broken);
      await expect(saveRecentFile(makeFile())).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalled();
    });

    it('loading reports no file rather than throwing', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.stubGlobal('indexedDB', broken);
      await expect(loadRecentFile()).resolves.toBeNull();
    });

    it('forgetting fails quietly', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.stubGlobal('indexedDB', broken);
      await expect(forgetRecentFile()).resolves.toBeUndefined();
    });
  });

  it('reports no file when the open request errors', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('indexedDB', {
      open: () => {
        const req: Record<string, unknown> = { error: new DOMException('nope', 'UnknownError') };
        queueMicrotask(() => (req.onerror as () => void)?.());
        return req;
      },
    });
    expect(await loadRecentFile()).toBeNull();
  });
});
