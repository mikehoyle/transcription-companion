// A stand-in for the small slice of Web Audio that chain.ts uses, so the
// processing chain can be tested without a browser. It records what was built
// and what was written to each AudioParam; it does not process any audio.
//
// Only used by tests — no production code imports it.

export class FakeParam {
  value = 0;
  /** Every setTargetAtTime, in order. */
  ramps: { value: number; time: number; constant: number }[] = [];
  cancelCount = 0;

  setTargetAtTime(value: number, time: number, constant: number) {
    this.ramps.push({ value, time, constant });
    // Tests read `.value` whichever way it was set; `ramps` tells them which.
    this.value = value;
  }

  cancelScheduledValues(_time: number) {
    this.cancelCount++;
  }
}

export interface FakeEdge {
  from: FakeNode;
  to: FakeNode;
  output: number;
  input: number;
}

export class FakeNode {
  disconnectCount = 0;

  constructor(
    readonly kind: string,
    private readonly ctx: FakeAudioContext,
  ) {}

  connect(to: FakeNode, output = 0, input = 0) {
    this.ctx.edges.push({ from: this, to, output, input });
    return to; // real nodes return the destination, which chain.ts chains off
  }

  disconnect() {
    this.disconnectCount++;
  }
}

export class FakeGainNode extends FakeNode {
  gain = new FakeParam();
  channelCount = 2;
  channelCountMode = 'max';
  channelInterpretation = 'speakers';
}

export class FakeBiquadNode extends FakeNode {
  type = 'peaking';
  frequency = new FakeParam();
  Q = new FakeParam();
  gain = new FakeParam();
}

export class FakePannerNode extends FakeNode {
  pan = new FakeParam();
}

export class FakeAudioContext {
  readonly edges: FakeEdge[] = [];
  readonly nodes: FakeNode[] = [];
  currentTime = 0;

  constructor(readonly sampleRate = 48000) {}

  private add<T extends FakeNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }

  createGain() {
    return this.add(new FakeGainNode('gain', this));
  }

  createBiquadFilter() {
    return this.add(new FakeBiquadNode('biquad', this));
  }

  createStereoPanner() {
    return this.add(new FakePannerNode('panner', this));
  }

  createChannelSplitter(_channels: number) {
    return this.add(new FakeNode('splitter', this));
  }

  createChannelMerger(_channels: number) {
    return this.add(new FakeNode('merger', this));
  }

  /** Nodes `from` feeds, in the order they were connected. */
  downstream(from: FakeNode): FakeNode[] {
    return this.edges.filter((e) => e.from === from).map((e) => e.to);
  }

  only<T extends FakeNode>(kind: string): T {
    const found = this.nodes.filter((n) => n.kind === kind);
    if (found.length !== 1) throw new Error(`expected one ${kind} node, found ${found.length}`);
    return found[0] as T;
  }
}
