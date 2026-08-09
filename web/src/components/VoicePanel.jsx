import { useEffect, useRef, useState } from "react";
import { X, Mic, MicOff, PhoneOff, Settings2 } from "lucide-react";
import Logo from "./Logo.jsx";
import { VoiceStateMachine } from "../voice/stateMachine.ts";
import { MicCapture } from "../voice/micCapture.ts";
import { PlaybackQueue } from "../voice/playbackQueue.ts";
import { VoiceConnectionManager } from "../voice/connectionManager.ts";
import { voiceLog } from "../voice/logger.ts";
import { DEFAULT_VAD_CONFIG } from "../voice/types.ts";

const LOCAL_VAD_THRESHOLD = 0.012;
const LOCAL_VAD_HANGOVER_MS = 350;

export default function VoicePanel({ onClose, onTaskChange, activeWorkspace = "Personal" }) {
  const [voiceState, setVoiceState] = useState("connecting");
  const [muted, setMuted] = useState(false);
  const [transcripts, setTranscripts] = useState([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [vadConfig, setVadConfig] = useState(DEFAULT_VAD_CONFIG);
  const [micApproved, setMicApproved] = useState(false);
  const [micPermission, setMicPermission] = useState("prompt");

  const machineRef = useRef(null);
  const micRef = useRef(null);
  const playbackRef = useRef(null);
  const connRef = useRef(null);
  const orbRef = useRef(null);
  const scrollRef = useRef(null);
  const levelRef = useRef(0);
  const lastLoudAtRef = useRef(0);
  const localSpeakingRef = useRef(false);
  const heardAudioThisTurnRef = useRef(false);

  useEffect(() => {
    let active = true;
    navigator.permissions?.query({ name: "microphone" }).then((status) => {
      if (!active) return;
      setMicPermission(status.state);
      if (status.state === "granted") setMicApproved(true);
      status.onchange = () => { setMicPermission(status.state); if (status.state === "granted") setMicApproved(true); };
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!micApproved) return undefined;
    const machine = new VoiceStateMachine();
    machineRef.current = machine;
    machine.onChange((next) => {
      voiceLog.event("state", next);
      setVoiceState(next);
    });

    function appendTranscript(role, text) {
      setTranscripts((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === role && !last.final) {
          return [...prev.slice(0, -1), { role, text: last.text + text, final: false }];
        }
        return [...prev, { role, text, final: false }];
      });
    }

    const playback = new PlaybackQueue({
      onQueueFrames: (frames) => voiceLog.queueSize((frames / 24000) * 1000),
    });
    playbackRef.current = playback;

    const conn = new VoiceConnectionManager(
      {
        onOpen: () => machine.transition("listening"),
        onAudio: (base64) => {
          playback.enqueueAudio(base64);
          heardAudioThisTurnRef.current = true;
          if (machine.current !== "speaking") machine.transition("speaking");
        },
        onModelText: () => {},
        onTranscript: (role, text) => appendTranscript(role, text),
        onInterrupted: () => {
          playback.clearQueue();
          if (machine.current === "speaking") {
            machine.transition("interrupted");
            machine.transition("user-speaking");
          }
        },
        onTurnComplete: () => {
          heardAudioThisTurnRef.current = false;
          if (machine.current === "speaking" || machine.current === "thinking") {
            machine.transition("listening");
          }
        },
        onToolResult: (name, _args, result) => {
          if (["add_task", "update_task", "complete_task", "delete_task", "create_task_from_email"].includes(name)) {
            onTaskChange?.();
          }
          if (name === "prepare_email_draft" && result?.requires_confirmation && result?.draft) {
            window.dispatchEvent(new CustomEvent("nudge:email-draft", { detail: result.draft }));
          }
          setTranscripts((prev) => [...prev, { role: "system", text: describeTool(name, result), final: true }]);
        },
        onGoAway: (ms) => voiceLog.event("go-away-scheduled", ms),
        onClose: () => machine.transition("disconnected"),
        onError: (message) => {
          setErrorMsg(message);
          machine.transition("error");
        },
        onReconnecting: () => machine.transition("reconnecting"),
      },
      vadConfig,
      { workspace: activeWorkspace },
    );
    connRef.current = conn;

    const mic = new MicCapture({
      onChunk: (base64) => conn.sendAudioChunk(base64),
      onLevel: (level) => {
        levelRef.current += (level - levelRef.current) * 0.35;
        const scale = 1 + Math.min(levelRef.current * 6, 0.35);
        if (orbRef.current) orbRef.current.style.transform = `scale(${scale})`;

        const now = performance.now();
        if (level > LOCAL_VAD_THRESHOLD) lastLoudAtRef.current = now;
        const isSpeaking = now - lastLoudAtRef.current < LOCAL_VAD_HANGOVER_MS;

        if (isSpeaking !== localSpeakingRef.current) {
          localSpeakingRef.current = isSpeaking;
          const state = machine.current;

          // Deliberately NOT gating playback on this. A raw RMS threshold
          // can't tell a word from a cough, a keyboard click, or a truck
          // outside — it fires on noise. Gemini's own VAD is speech-aware
          // and is the only thing allowed to cut audio; that happens over
          // in onInterrupted below, driven by the server's `interrupted`
          // event. This local level is UI-only: it drives the orb and the
          // idle listening<->user-speaking label, and only while the
          // assistant isn't already talking.
          if (isSpeaking) {
            voiceLog.speechStart("local");
            if (state === "listening") {
              machine.transition("user-speaking");
            }
          } else {
            voiceLog.speechEnd("local");
            if (state === "user-speaking") {
              machine.transition("thinking");
            }
          }
        }
      },
    });
    micRef.current = mic;
    let unmounted = false;

    (async () => {
      try {
        machine.transition("connecting");
        await playback.init();
        await conn.connect();
        await mic.start();
      } catch (err) {
        if (unmounted) return; // StrictMode's first pass was already torn down
        setErrorMsg(err.message || "Could not start voice session");
        machine.transition("error");
      }
    })();

    return () => {
      unmounted = true;
      mic.stop();
      playback.dispose();
      conn.disconnect();
    };
  }, [micApproved]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [transcripts]);

  function describeTool(name, result) {
    if (name === "add_task" && result?.task) return `Added: "${result.task.text}"`;
    if (name === "update_task" && result?.task) return `Updated: "${result.task.text}"`;
    if (name === "complete_task" && result?.ok) return "Marked a task done";
    if (name === "delete_task" && result?.ok) return "Deleted a task";
    if (name === "list_tasks") return `Checked ${result?.count ?? 0} task(s)`;
    if (name === "remember_memory" && result?.ok === true) return "Saved to Second Brain";
    if (name === "remember_memory" && result?.duplicate) return "That memory already exists in Second Brain";
    if (name === "remember_memory") return `Memory was not saved${result?.error ? `: ${result.error}` : ""}`;
    if (name === "recall_memory") return `Recalled ${result?.results?.length ?? 0} memory item(s)`;
    if (name === "list_recent_memories") return "Checked recent memories";
    if (name === "list_email_accounts") return `Checked ${result?.accounts?.length ?? 0} email account(s)`;
    if (name === "list_email_inbox" || name === "search_email") return `Checked ${result?.messages?.length ?? 0} email header(s)`;
    if (name === "read_email") return result?.ok ? "Read the selected email" : "Could not read that email";
    if (name === "prepare_email_draft") return result?.ok ? "Draft ready for your review" : "Could not prepare the draft";
    if (name === "create_task_from_email") return result?.ok ? "Created a task from email" : "Could not create the task";
    return "";
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    micRef.current?.setMuted(next);
  }

  function handleEnd() {
    onClose?.();
  }

  const statusLabel = {
    connecting: "Connecting…",
    listening: "Listening — talk to Nudge",
    "user-speaking": "Hearing you…",
    thinking: "Thinking…",
    speaking: "Nudge is speaking",
    interrupted: "Nudge is speaking",
    reconnecting: "Reconnecting…",
    error: errorMsg || "Something went wrong",
    disconnected: "Session ended",
  }[voiceState];


  if (!micApproved) {
    return <div className="voice-overlay">
      <button className="voice-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
      <div className="voice-mic-onboarding">
        <div className="voice-orb"><div className="voice-orb-inner"><Logo size={34} /></div></div>
        <h2>Talk to Nudge</h2>
        <p>Nudge needs microphone access to hear your tasks and reminders. Your audio is used for this voice session and is not saved as memory.</p>
        {micPermission === "denied" && <div className="voice-error">Microphone access is blocked. Allow it for this site in browser settings, then try again.</div>}
        <button className="voice-allow-btn" onClick={() => setMicApproved(true)}>Allow microphone</button>
      </div>
    </div>;
  }

  return (
    <div className="voice-overlay">
      <main className="voice-chat">
        <div className="voice-status">{statusLabel}</div>
        <div className="voice-transcript" ref={scrollRef}>
          {transcripts.length === 0 && voiceState === "listening" && (
            <div className="voice-hint">Try: "What do I have today?" or "Add a task to call the dentist tomorrow at 3"</div>
          )}
          {transcripts.map((m, i) => (
            <div key={i} className={`voice-line ${m.role}`}>
              {m.text}
            </div>
          ))}
        </div>
      </main>

      <footer className="voice-bottom-bar">
        <div className={`voice-bar-status ${voiceState}`} title={statusLabel} aria-label={statusLabel}>
          <Logo size={21} />
        </div>
        <button className="voice-control-btn settings" onClick={() => setShowSettings((s) => !s)} aria-label="Voice settings"><Settings2 size={18} /></button>
        <button className={`voice-control-btn ${muted ? "active" : ""}`} onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
          {muted ? <MicOff size={20} /> : <Mic size={20} />}
        </button>
        <button className="voice-control-btn end" onClick={handleEnd} aria-label="End conversation">
          <PhoneOff size={20} />
        </button>
      </footer>
      {showSettings && <VadSettingsPanel vadConfig={vadConfig} onChange={setVadConfig} onClose={() => setShowSettings(false)} />}
    </div>
  );
}

function VadSettingsPanel({ vadConfig, onChange, onClose }) {
  return (
    <div className="voice-settings-panel">
      <div className="voice-settings-head">
        <strong>VAD tuning (dev)</strong>
        <button onClick={onClose} aria-label="Close settings">
          <X size={14} />
        </button>
      </div>

      <label>
        Start sensitivity
        <select
          value={vadConfig.startSensitivity}
          onChange={(e) => onChange({ ...vadConfig, startSensitivity: e.target.value })}
        >
          <option value="START_SENSITIVITY_HIGH">High</option>
          <option value="START_SENSITIVITY_LOW">Low</option>
        </select>
      </label>

      <label>
        End sensitivity
        <select
          value={vadConfig.endSensitivity}
          onChange={(e) => onChange({ ...vadConfig, endSensitivity: e.target.value })}
        >
          <option value="END_SENSITIVITY_HIGH">High</option>
          <option value="END_SENSITIVITY_LOW">Low</option>
        </select>
      </label>

      <label>
        Prefix padding (ms)
        <input
          type="number"
          value={vadConfig.prefixPaddingMs}
          onChange={(e) => onChange({ ...vadConfig, prefixPaddingMs: Number(e.target.value) })}
        />
      </label>

      <label>
        Silence duration (ms)
        <input
          type="number"
          value={vadConfig.silenceDurationMs}
          onChange={(e) => onChange({ ...vadConfig, silenceDurationMs: Number(e.target.value) })}
        />
      </label>

      <p className="voice-settings-note">Changes apply on next reconnect — VAD is baked into the session token at connect time.</p>
    </div>
  );
}
