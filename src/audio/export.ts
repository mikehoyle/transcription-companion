import SignalsmithStretch from 'signalsmith-stretch';
import { createChain } from './chain';
import { encodeWav } from './wav';
import type { AppState } from '../store';

/**
 * Render a region of the file with the current speed, pitch, channel and EQ
 * settings to a WAV blob, entirely offline in the browser.
 */
export async function renderProcessed(buffer: AudioBuffer, state: AppState, start: number, end: number): Promise<Blob> {
  const sr = buffer.sampleRate;
  const rate = state.rate;
  const outDur = (end - start) / rate;
  const tail = 0.25;

  // Probe latency with a throwaway context so we can pre-roll by that amount.
  const probe = new OfflineAudioContext(2, sr, sr);
  const probeNode = await SignalsmithStretch(probe, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
  const latency = await probeNode.latency();

  const pre = Math.ceil(latency * sr) / sr;
  const length = Math.ceil((pre + outDur + tail) * sr);
  const ctx = new OfflineAudioContext(2, length, sr);
  const stretch = await SignalsmithStretch(ctx, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });

  // only hand over the needed region (plus a little context either side)
  const pad = 1;
  const from = Math.max(0, Math.floor((start - pad) * sr));
  const to = Math.min(buffer.length, Math.ceil((end + pad) * sr));
  const chans: Float32Array[] = [];
  for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) chans.push(buffer.getChannelData(c).slice(from, to));
  if (chans.length === 1) chans.push(chans[0].slice());
  const offsetSec = from / sr;
  await stretch.addBuffers(
    chans,
    chans.map((c) => c.buffer),
  );

  // A single schedule() call: the node drops any change timed at/after its
  // current time when a new one is scheduled, so we don't schedule a stop —
  // the render is simply trimmed to length instead.
  await stretch.schedule({
    output: 0,
    active: true,
    input: start - offsetSec - pre * rate,
    rate,
    semitones: state.semitones + state.cents / 100,
    formantCompensation: state.formant,
    formantBaseHz: 0,
    loopStart: 0,
    loopEnd: 0,
  });

  const chain = createChain(ctx);
  stretch.connect(chain.input);
  chain.output.connect(ctx.destination);
  chain.apply(state, true);

  const rendered = await ctx.startRendering();
  const skip = Math.round(pre * sr);
  const outLen = Math.min(rendered.length - skip, Math.ceil((outDur + 0.05) * sr));
  const out = [0, 1].map((c) => rendered.getChannelData(c).slice(skip, skip + outLen));
  // gentle fade in/out to avoid clicks at the region edges
  const fade = Math.min(Math.round(0.005 * sr), outLen >> 1);
  for (const ch of out) {
    for (let i = 0; i < fade; i++) {
      ch[i] *= i / fade;
      ch[outLen - 1 - i] *= i / fade;
    }
  }
  return encodeWav(out, sr);
}
