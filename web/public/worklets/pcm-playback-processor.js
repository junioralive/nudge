// Playback side of the pipeline. Holds a small FIFO of Float32 chunks and
// drains it 128 samples at a time into the output. The whole point of doing
// this in a worklet rather than scheduling AudioBufferSourceNodes is that
// `clear` here is sample-accurate and instant — there's no "already scheduled"
// buffer that keeps playing after a cancel, which is what barge-in needs.
class PcmPlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.readOffset = 0;
    this.queuedFrames = 0;
    this.reportCounter = 0;

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === "enqueue") {
        this.queue.push(msg.samples);
        this.queuedFrames += msg.samples.length;
      } else if (msg.type === "clear") {
        this.queue = [];
        this.readOffset = 0;
        this.queuedFrames = 0;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0][0];

    for (let i = 0; i < output.length; i++) {
      if (this.queue.length === 0) {
        output[i] = 0;
        continue;
      }
      const chunk = this.queue[0];
      output[i] = chunk[this.readOffset++];
      this.queuedFrames--;

      if (this.readOffset >= chunk.length) {
        this.queue.shift();
        this.readOffset = 0;
      }
    }

    // Let the main thread know roughly how much is buffered — used for the
    // "keep only ~80-180ms scheduled" cap and dev logging. Throttled: posting
    // every 128-sample callback would flood the main thread with messages.
    if (++this.reportCounter >= 20) {
      this.reportCounter = 0;
      this.port.postMessage({ type: "queueFrames", frames: this.queuedFrames });
    }

    return true;
  }
}

registerProcessor("pcm-playback-processor", PcmPlaybackProcessor);
