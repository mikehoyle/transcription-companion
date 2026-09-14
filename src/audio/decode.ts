import type { FFmpeg } from '@ffmpeg/ffmpeg';

export const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'ogv', '3gp'];

export const ACCEPT =
  'audio/*,video/*,.mp3,.wav,.wave,.flac,.ogg,.oga,.opus,.m4a,.aac,.alac,.aif,.aiff,.aifc,.wma,.ape,.wv,.ac3,.eac3,.dts,.amr,.au,.snd,.caf,.mka,.mpc,.tta,.ra,.spx,.mid,' +
  VIDEO_EXTENSIONS.map((e) => '.' + e).join(',');

export const extension = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || VIDEO_EXTENSIONS.includes(extension(file.name));
}

export interface DecodeResult {
  buffer: AudioBuffer;
  decoder: 'native' | 'ffmpeg';
}

type Progress = (message: string, progress: number | null) => void;

/**
 * Decode an audio (or video) file entirely in the browser. Uses the browser's
 * own decoder when it can; otherwise lazily loads ffmpeg.wasm (~30 MB, served
 * from this site) to convert the audio track to WAV first.
 */
export async function decodeFile(file: File, ctx: BaseAudioContext, onProgress: Progress): Promise<DecodeResult> {
  onProgress(`Reading ${file.name}…`, null);
  const data = await file.arrayBuffer();

  onProgress('Decoding audio…', null);
  try {
    const buffer = await ctx.decodeAudioData(data.slice(0));
    if (buffer.duration > 0) return { buffer, decoder: 'native' };
  } catch {
    // fall through to ffmpeg
  }

  const wav = await convertWithFFmpeg(file.name, new Uint8Array(data), onProgress);
  onProgress('Decoding converted audio…', null);
  const buffer = await ctx.decodeAudioData(wav.buffer as ArrayBuffer);
  return { buffer, decoder: 'ffmpeg' };
}

async function convertWithFFmpeg(name: string, data: Uint8Array, onProgress: Progress): Promise<Uint8Array> {
  onProgress('This format needs the extended decoder — loading ffmpeg.wasm (first time only)…', null);
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ffmpeg: FFmpeg = new FFmpeg();
  let wasmURL: string | null = null;
  try {
    const core = await fetchFFmpegCore(onProgress);
    wasmURL = core.wasmURL;
    onProgress('Starting extended decoder…', null);
    await ffmpeg.load(core);
  } catch (e) {
    throw new Error(`Could not load the extended decoder (${e instanceof Error ? e.message : e}).`);
  } finally {
    // the worker has already read the wasm by the time load() settles
    if (wasmURL) URL.revokeObjectURL(wasmURL);
  }

  const logs: string[] = [];
  ffmpeg.on('log', ({ message }) => {
    logs.push(message);
    if (logs.length > 40) logs.shift();
  });
  ffmpeg.on('progress', ({ progress }) => {
    if (progress >= 0 && progress <= 1) onProgress('Converting with ffmpeg…', progress);
  });

  const input = 'input.' + (extension(name) || 'bin');
  try {
    await ffmpeg.writeFile(input, data);
    onProgress('Converting with ffmpeg…', 0);
    const code = await ffmpeg.exec(['-hide_banner', '-i', input, '-vn', '-map', '0:a:0', '-c:a', 'pcm_s16le', '-f', 'wav', 'output.wav']);
    if (code !== 0) {
      const hint = logs.find((l) => /Invalid data|does not contain any stream|matches no streams|Unknown/i.test(l));
      throw new Error(hint ? `Unsupported file: ${hint.trim()}` : 'This file could not be decoded — it may not contain audio.');
    }
    const out = await ffmpeg.readFile('output.wav');
    if (typeof out === 'string') throw new Error('Unexpected ffmpeg output');
    return out;
  } finally {
    ffmpeg.terminate();
  }
}

/** Written by scripts/copy-ffmpeg.mjs. Paths are relative to /ffmpeg/. */
interface FFmpegManifest {
  version: string;
  core: string;
  wasmParts: string[];
  wasmSize: number;
}

/**
 * The ffmpeg wasm binary is served in parts (static hosts such as Cloudflare
 * Pages cap individual files at 25 MiB); download them in parallel and
 * reassemble into a blob: URL for ffmpeg.load().
 */
async function fetchFFmpegCore(onProgress: Progress): Promise<{ coreURL: string; wasmURL: string }> {
  const base = new URL('ffmpeg/', document.baseURI);
  const res = await fetch(new URL('manifest.json', base), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`manifest.json: HTTP ${res.status}`);
  const manifest = (await res.json()) as FFmpegManifest;

  let received = 0;
  onProgress('Downloading extended decoder (first time only)…', 0);
  const parts = await Promise.all(
    manifest.wasmParts.map(async (path) => {
      const r = await fetch(new URL(path, base));
      if (!r.ok || !r.body) throw new Error(`${path}: HTTP ${r.status}`);
      const reader = r.body.getReader();
      const chunks: BlobPart[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        onProgress('Downloading extended decoder (first time only)…', Math.min(1, received / manifest.wasmSize));
      }
      return new Blob(chunks);
    }),
  );
  const wasm = new Blob(parts, { type: 'application/wasm' });
  if (wasm.size !== manifest.wasmSize) {
    throw new Error(`decoder download was incomplete (${wasm.size} of ${manifest.wasmSize} bytes)`);
  }
  return { coreURL: new URL(manifest.core, base).href, wasmURL: URL.createObjectURL(wasm) };
}

/** Mono mixdown resampled to `rate` Hz, used for analysis. */
export async function mixdownForAnalysis(buffer: AudioBuffer, rate: number): Promise<Float32Array> {
  const length = Math.ceil(buffer.duration * rate);
  const offline = new OfflineAudioContext(1, length, rate);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}
