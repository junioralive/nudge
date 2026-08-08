import { GoogleGenAI, type Session, type LiveServerMessage } from "@google/genai";
import { executeTool } from "./toolExecutor.js";
import { voiceLog } from "./logger.js";
import type { VadConfig } from "./types.js";
import { DEFAULT_VAD_CONFIG } from "./types.js";

const MAX_RECONNECT_ATTEMPTS = 4;

export interface ConnectionCallbacks {
  onAudio: (base64: string, mimeType: string) => void;
  onModelText: (text: string) => void;
  onTranscript: (role: "user" | "assistant", text: string) => void;
  onInterrupted: () => void;
  onTurnComplete: () => void;
  onToolResult: (name: string, args: Record<string, unknown>, result: unknown) => void;
  onGoAway: (timeLeftMs: number) => void;
  onOpen: () => void;
  onClose: (reason: string) => void;
  onError: (message: string) => void;
  onReconnecting: (attempt: number) => void;
}

// Owns the direct browser-to-Gemini Live connection. The backend's only job
// (see server/routes/voiceToken.js) is minting a short-lived, single-use token
// with the system prompt/tools/VAD already baked in — the real API key never
// reaches this file. Every server event fans out here; nothing gets dropped
// silently, which matters because a live audio/text/tool-call/interruption
// stream genuinely does arrive interleaved like this.
export class VoiceConnectionManager {
  private session: Session | null = null;
  private callbacks: ConnectionCallbacks;
  private vadConfig: VadConfig;

  // Bumped on every disconnect/reconnect. Async work (tool calls in flight,
  // pending fetches) checks its captured generation against the current one
  // before touching state — stale results from a superseded session are
  // dropped instead of corrupting the new one.
  private generation = 0;
  private sessionResumptionHandle: string | null = null;
  private reconnectAttempts = 0;
  private userInitiatedClose = false;
  private sessionReady = false;
  private setupFallbackTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(callbacks: ConnectionCallbacks, vadConfig: VadConfig = DEFAULT_VAD_CONFIG, private toolContext: { workspace?: string } = {}) {
    this.callbacks = callbacks;
    this.vadConfig = vadConfig;
  }

  async connect(): Promise<void> {
    this.userInitiatedClose = false;
    this.sessionReady = false;
    const myGeneration = ++this.generation;
    voiceLog.wsStatus("requesting ephemeral token");

    const tokenRes = await fetch("/api/voice-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vad: this.vadConfig }),
    });
    const body = (await tokenRes.json().catch(() => ({}))) as { error?: string; token?: string; model?: string };
    if (!tokenRes.ok) {
      throw new Error(body.error || "Could not get a voice session token");
    }
    const { token, model } = body;
    if (!token || !model) throw new Error("Voice session response was incomplete");
    if (myGeneration !== this.generation) return; // superseded while awaiting the token

    // Ephemeral auth tokens are v1alpha-only — see @google/genai's Tokens.create() docs.
    const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1alpha" } });

    const session = await ai.live.connect({
      model,
      // Config is intentionally minimal — the ephemeral token already carries
      // the system instruction, tools, and VAD tuning (liveConnectConstraints
      // on the server). Passing it again here would just be a client-side
      // copy the server can't actually enforce.
      config: this.sessionResumptionHandle
        ? { sessionResumption: { handle: this.sessionResumptionHandle } }
        : {},
      callbacks: {
        onopen: () => {
          if (myGeneration !== this.generation) return;
          // WS open just means the socket connected — Gemini hasn't
          // confirmed the session is actually ready yet. We wait for
          // `setupComplete` (below, in handleMessage) before telling the
          // caller it's safe to start streaming audio.
          voiceLog.wsStatus("socket open, awaiting setupComplete");
          this.reconnectAttempts = 0;

          // Safety valve: if setupComplete never arrives (SDK/model version
          // drift, a field we're not matching), don't sit there dropping
          // every mic chunk forever — that reads as "connected but silent
          // and stuck," which is worse than proceeding without the ack.
          this.setupFallbackTimer = setTimeout(() => {
            if (myGeneration !== this.generation || this.sessionReady) return;
            voiceLog.wsStatus("setupComplete never arrived — proceeding anyway");
            this.sessionReady = true;
            this.callbacks.onOpen();
          }, 1500);
        },
        onmessage: (message: LiveServerMessage) => {
          if (myGeneration !== this.generation) return;
          this.handleMessage(message, myGeneration);
        },
        onerror: (e: ErrorEvent) => {
          if (myGeneration !== this.generation) return;
          voiceLog.wsStatus(`error: ${e.message}`);
          this.callbacks.onError(e.message);
        },
        onclose: (e: CloseEvent) => {
          if (myGeneration !== this.generation) return;
          voiceLog.wsStatus(`closed: ${e.reason || "no reason"}`);
          this.handleClose(e.reason, myGeneration);
        },
      },
    });

    // CRITICAL: `ai.live.connect()` is async, so disconnect() may have already
    // run while we were awaiting it (React StrictMode's mount/unmount/remount
    // does exactly this in dev). If our generation is stale, this session is
    // an orphan nobody holds a reference to — close it immediately. Skipping
    // this leaks a second live session that keeps streaming audio, which is
    // heard as two assistant voices talking over each other.
    if (myGeneration !== this.generation) {
      voiceLog.wsStatus("discarding superseded session");
      session.close();
      return;
    }

    this.session = session;
  }

  private async handleMessage(message: LiveServerMessage, myGeneration: number): Promise<void> {
    if (message.setupComplete) {
      if (this.setupFallbackTimer) {
        clearTimeout(this.setupFallbackTimer);
        this.setupFallbackTimer = null;
      }
      if (!this.sessionReady) {
        voiceLog.wsStatus("setupComplete — safe to stream audio");
        this.sessionReady = true;
        this.callbacks.onOpen();
      }
    }

    const sc = message.serverContent;

    if (sc?.interrupted) {
      voiceLog.interrupted();
      this.callbacks.onInterrupted();
    }

    if (sc?.inputTranscription?.text) {
      this.callbacks.onTranscript("user", sc.inputTranscription.text);
    }
    if (sc?.outputTranscription?.text) {
      this.callbacks.onTranscript("assistant", sc.outputTranscription.text);
    }

    // A turn can carry several parts (audio AND text AND more) — handle all of them.
    const parts = sc?.modelTurn?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        this.callbacks.onAudio(part.inlineData.data, part.inlineData.mimeType ?? "audio/pcm;rate=24000");
      }
      if (part.text) {
        this.callbacks.onModelText(part.text);
      }
    }

    if (message.toolCall?.functionCalls?.length) {
      const responses = [];
      for (const call of message.toolCall.functionCalls) {
        const result = await executeTool(call.name ?? "", (call.args as Record<string, unknown>) ?? {}, this.toolContext);
        if (myGeneration !== this.generation) return; // session moved on while the tool ran
        responses.push({ id: call.id, name: call.name, response: { result } });
        this.callbacks.onToolResult(call.name ?? "", (call.args as Record<string, unknown>) ?? {}, result);
      }
      this.session?.sendToolResponse({ functionResponses: responses });
    }

    if (message.toolCallCancellation?.ids?.length) {
      voiceLog.event("tool-cancel", message.toolCallCancellation.ids);
      // Nothing to roll back on our side — executeTool() calls are short REST
      // round-trips, not long-running work we could meaningfully abort mid-flight.
    }

    if (message.sessionResumptionUpdate?.resumable && message.sessionResumptionUpdate.newHandle) {
      this.sessionResumptionHandle = message.sessionResumptionUpdate.newHandle;
      voiceLog.event("session-resumption-handle-updated");
    }

    if (message.goAway?.timeLeft) {
      const timeLeftMs = Number(message.goAway.timeLeft.replace("s", "")) * 1000;
      voiceLog.event("go-away", `${timeLeftMs}ms left`);
      this.callbacks.onGoAway(timeLeftMs);
    }

    if (message.usageMetadata) {
      voiceLog.event("usage", message.usageMetadata);
    }

    if (sc?.turnComplete) {
      voiceLog.turnComplete();
      this.callbacks.onTurnComplete();
    }
  }

  private handleClose(reason: string, myGeneration: number): void {
    this.session = null;
    this.sessionReady = false;
    if (this.setupFallbackTimer) {
      clearTimeout(this.setupFallbackTimer);
      this.setupFallbackTimer = null;
    }
    if (this.userInitiatedClose) {
      this.callbacks.onClose(reason);
      return;
    }

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.callbacks.onError("Lost connection and couldn't reconnect.");
      return;
    }

    this.reconnectAttempts++;
    voiceLog.reconnectAttempt(this.reconnectAttempts);
    this.callbacks.onReconnecting(this.reconnectAttempts);

    const backoffMs = Math.min(1000 * 2 ** (this.reconnectAttempts - 1), 8000);
    setTimeout(() => {
      if (myGeneration !== this.generation) return;
      this.connect().catch((err) => this.callbacks.onError(err.message));
    }, backoffMs);
  }

  sendAudioChunk(base64Pcm16: string): void {
    // Mic capture starts as soon as permission is granted, which can race
    // ahead of Gemini's setupComplete — drop chunks until the session
    // actually confirmed it's ready rather than sending into a socket that
    // isn't listening yet.
    if (!this.sessionReady) return;
    this.session?.sendRealtimeInput({ audio: { data: base64Pcm16, mimeType: "audio/pcm;rate=16000" } });
  }

  sendText(text: string): void {
    this.session?.sendClientContent({ turns: [text] });
  }

  disconnect(): void {
    this.userInitiatedClose = true;
    this.generation++; // invalidate any in-flight async work immediately
    if (this.setupFallbackTimer) {
      clearTimeout(this.setupFallbackTimer);
      this.setupFallbackTimer = null;
    }
    this.session?.close();
    this.session = null;
  }
}
