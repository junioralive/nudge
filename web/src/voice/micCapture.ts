const TARGET_RATE = 16000;

function downsample(input: Float32Array, inputRate: number, targetRate: number): Float32Array {
  if (inputRate === targetRate) return input;
  const ratio = inputRate / targetRate;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    out[i] = input[Math.floor(i * ratio)];
  }
  return out;
}

function floatTo16BitPCM(float32: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function bufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

export interface MicCaptureCallbacks {
  onChunk: (base64Pcm16: string) => void;
  onLevel: (rms: number) => void;
}

// Mic capture pipeline: getUserMedia -> AudioWorklet (native-rate buffering) ->
// downsample to 16kHz -> Int16 LE -> base64, streamed continuously to the
// caller regardless of mute state (mute just stops emitting chunks — the
// worklet and stream keep running so there's no re-negotiation lag to unmute).
export class MicCapture {
  private audioCtx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private muted = false;
  private disposed = false;
  private callbacks: MicCaptureCallbacks;

  constructor(callbacks: MicCaptureCallbacks) {
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    } catch (err) {
      throw new Error(
        `Microphone access denied or unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // stop() may have run while we awaited the permission prompt (StrictMode
    // remount, or the user closing the panel fast). Release the tracks we just
    // acquired instead of leaving a second live mic feeding audio to Gemini.
    if (this.disposed) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;

    const audioCtx = new AudioContext();
    await audioCtx.audioWorklet.addModule("/worklets/pcm-capture-processor.js");

    if (this.disposed) {
      stream.getTracks().forEach((t) => t.stop());
      audioCtx.close();
      return;
    }
    this.audioCtx = audioCtx;

    this.sourceNode = this.audioCtx.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(this.audioCtx, "pcm-capture-processor");

    const inputRate = this.audioCtx.sampleRate;

    this.workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const samples = event.data;
      this.callbacks.onLevel(rms(samples));
      if (this.muted) return;

      const downsampled = downsample(samples, inputRate, TARGET_RATE);
      const pcm = floatTo16BitPCM(downsampled);
      this.callbacks.onChunk(bufferToBase64(pcm));
    };

    this.sourceNode.connect(this.workletNode);
    // Not connected to destination — we never want to hear our own mic loopback.
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  stop(): void {
    this.disposed = true;
    this.workletNode?.disconnect();
    this.sourceNode?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.audioCtx?.close();
    this.audioCtx = null;
    this.stream = null;
    this.sourceNode = null;
    this.workletNode = null;
  }
}
