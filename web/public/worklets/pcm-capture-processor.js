// Runs on the audio render thread — AudioWorkletGlobalScope, no DOM access.
// Job here is just to buffer raw mic samples at the browser's native rate
// (44.1k/48k) into reasonably sized chunks and hand them to the main thread.
// Resampling to 16kHz + Int16 conversion happens in micCapture.ts, where it's
// far easier to get right than inside a 128-sample-per-call render callback.
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkSize = 2048;
    this.buffer = new Float32Array(this.chunkSize);
    this.writeIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.writeIndex++] = channel[i];
      if (this.writeIndex === this.chunkSize) {
        this.port.postMessage(this.buffer.slice(0));
        this.writeIndex = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture-processor", PcmCaptureProcessor);
