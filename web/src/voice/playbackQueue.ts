const PLAYBACK_RATE = 24000; // Gemini's output PCM rate

// Purely a last-resort guard against a genuinely frozen tab leaking memory
// forever — NOT a normal-operation throttle. Gemini legitimately bursts audio
// faster than realtime (a whole turn can arrive in under a second), and this
// FIFO-worklet design means buffering more does not hurt barge-in latency at
// all (clearQueue() empties it instantly regardless of size). Dropping chunks
// here deletes actual words from the response — that's not backpressure
// relief, it's the app eating its own speech. Kept enormous on purpose.
const MAX_BUFFERED_MS = 60_000;

function base64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const samples = new Float32Array(bytes.length / 2);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return samples;
}

export interface PlaybackQueueCallbacks {
  onQueueFrames?: (frames: number) => void;
}

// Audio-out side of the pipeline. Runs a tiny AudioWorklet that drains a FIFO
// of Float32 chunks sample-by-sample. The reason this exists instead of the
// more common "schedule a bunch of AudioBufferSourceNodes ahead of time"
// pattern: on barge-in we need playback to stop *this sample*, not at the
// next scheduled node boundary. clearQueue() below does exactly that.
export class PlaybackQueue {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private queuedFrames = 0;
  private disposed = false;
  private callbacks: PlaybackQueueCallbacks;

  constructor(callbacks: PlaybackQueueCallbacks = {}) {
    this.callbacks = callbacks;
  }

  async init(): Promise<void> {
    this.disposed = false;
    const ctx = new AudioContext({ sampleRate: PLAYBACK_RATE });
    await ctx.audioWorklet.addModule("/worklets/pcm-playback-processor.js");

    // dispose() may have run while addModule() was in flight. Tear down the
    // context we just built rather than leaving a second output node wired to
    // the speakers — that's an extra voice playing over the real one.
    if (this.disposed) {
      ctx.close();
      return;
    }

    this.ctx = ctx;
    this.node = new AudioWorkletNode(ctx, "pcm-playback-processor");
    this.node.port.onmessage = (event: MessageEvent<{ type: string; frames: number }>) => {
      if (event.data.type === "queueFrames") {
        this.queuedFrames = event.data.frames;
        this.callbacks.onQueueFrames?.(event.data.frames);
      }
    };
    this.node.connect(ctx.destination);
  }

  /** Push a base64 PCM16 chunk (24kHz) onto the playback FIFO. */
  enqueueAudio(base64Pcm16: string): void {
    if (!this.node) return;

    const bufferedMs = (this.queuedFrames / PLAYBACK_RATE) * 1000;
    if (bufferedMs > MAX_BUFFERED_MS) {
      // Backpressure valve: something's badly behind (stuck tab, network
      // burst). Drop this chunk rather than let the buffer grow unbounded —
      // a brief glitch beats an ever-growing lag between speech and audio.
      console.warn(`[playback] buffer at ${bufferedMs.toFixed(0)}ms, dropping chunk`);
      return;
    }

    const samples = base64ToFloat32(base64Pcm16);
    this.node.port.postMessage({ type: "enqueue", samples }, [samples.buffer]);
  }

  /** Sample-accurate stop: empties the worklet's FIFO immediately. */
  clearQueue(): void {
    this.node?.port.postMessage({ type: "clear" });
    this.queuedFrames = 0;
  }

  /** Alias used at barge-in call sites — same effect, named for that intent. */
  cancelScheduledAudio(): void {
    this.clearQueue();
  }

  /** Full teardown + reinit — used after errors or before a fresh session. */
  async resetAudioOutput(): Promise<void> {
    this.dispose();
    await this.init();
  }

  bufferedMs(): number {
    return (this.queuedFrames / PLAYBACK_RATE) * 1000;
  }

  dispose(): void {
    this.disposed = true;
    this.node?.disconnect();
    this.ctx?.close();
    this.ctx = null;
    this.node = null;
    this.queuedFrames = 0;
  }
}
