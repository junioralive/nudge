import { useEffect, useMemo, useRef, useState } from "react";
import { BellRing, Brain, Check, LoaderCircle, Mail, Mic2, UserRound, Volume2, X } from "lucide-react";
import { PlaybackQueue } from "../voice/playbackQueue.ts";
import { VoiceConnectionManager } from "../voice/connectionManager.ts";
import { ASSISTANT_VOICES } from "../voice/voiceCatalog.js";

function availableTimezones(current) {
  const defaults = ["UTC", "Asia/Kolkata", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Singapore", "Australia/Sydney"];
  const supported = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : defaults;
  return [...new Set([current, ...defaults, ...supported].filter(Boolean))];
}

export default function SettingsView({ profile, capabilities, onSave, onClose }) {
  const [draft, setDraft] = useState(profile);
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem("nudge-sound") !== "off");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [section, setSection] = useState("profile");
  const previewRef = useRef(null);
  const timezones = useMemo(() => availableTimezones(draft.timezone), [draft.timezone]);

  useEffect(() => setDraft(profile), [profile]);
  useEffect(() => () => previewRef.current?.(), []);
  useEffect(() => {
    const closeOnEscape = (event) => event.key === "Escape" && onClose?.();
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  function update(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
    setStatus("");
  }

  function toggleSound() {
    const next = !soundEnabled;
    setSoundEnabled(next);
    localStorage.setItem("nudge-sound", next ? "on" : "off");
  }

  async function save() {
    setSaving(true);
    setStatus("");
    try {
      await onSave(draft);
      setStatus("Settings saved");
    } catch (error) {
      setStatus(error.message || "Could not save settings");
    } finally {
      setSaving(false);
    }
  }

  async function previewVoice() {
    previewRef.current?.();
    setPreviewing(true);
    setStatus(`Preparing ${draft.assistantVoice}…`);
    const playback = new PlaybackQueue();
    let connection;
    let disposed = false;
    let drainTimer;
    let resolveOpen;
    const opened = new Promise((resolve) => { resolveOpen = resolve; });
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      clearTimeout(drainTimer);
      connection?.disconnect();
      playback.dispose();
      previewRef.current = null;
      setPreviewing(false);
    };
    previewRef.current = cleanup;

    try {
      await playback.init();
      await onSave(draft);
      connection = new VoiceConnectionManager({
        onOpen: () => resolveOpen(true),
        onAudio: (audio) => playback.enqueueAudio(audio),
        onModelText: () => {},
        onTranscript: () => {},
        onInterrupted: () => {},
        onToolResult: () => {},
        onGoAway: () => {},
        onReconnecting: () => {},
        onClose: () => {},
        onError: (message) => { resolveOpen(false); setStatus(message || "Could not preview this voice"); cleanup(); },
        onTurnComplete: () => {
          connection.disconnect();
          const waitForAudio = () => {
            if (playback.bufferedMs() > 0) drainTimer = setTimeout(waitForAudio, 150);
            else { setStatus(`${draft.assistantVoice} preview complete`); cleanup(); }
          };
          drainTimer = setTimeout(waitForAudio, 150);
        },
      });
      await connection.connect();
      if (!await opened) return;
      setStatus(`Playing ${draft.assistantVoice}…`);
      connection.sendText("Voice preview only. Say exactly: Hi, I'm Nudge. This is how I sound.");
    } catch (error) {
      setStatus(error.message || "Could not preview this voice");
      cleanup();
    }
  }

  const menu = [
    ["profile", UserRound, "Profile"],
    ["assistant", Mic2, "Assistant"],
    ["notifications", BellRing, "Notifications"],
    ["capabilities", Brain, "Capabilities"],
  ];

  const saveFooter = <footer className="settings-panel-footer">
    <span className={status.includes("saved") ? "success" : ""}>{status}</span>
    <button type="button" onClick={save} disabled={saving || !draft.name.trim()}>{saving ? "Saving…" : "Save changes"}</button>
  </footer>;

  return <section className="settings-view" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
    <div className="settings-dialog">
      <header className="settings-head">
        <h2 id="settings-title">Settings</h2>
        <button type="button" className="settings-close" onClick={onClose} aria-label="Close settings"><X size={18} /></button>
      </header>

      <div className="settings-layout">
        <nav className="settings-menu" aria-label="Settings sections">
          {menu.map(([id, Icon, label]) => <button type="button" key={id} className={section === id ? "active" : ""} onClick={() => { setSection(id); setStatus(""); }}><Icon size={16} /><span>{label}</span></button>)}
        </nav>

        <div className="settings-panel">
        {section === "profile" && <article className="settings-card">
          <div className="settings-card-title"><UserRound size={18} /><div><h3>Profile</h3><p>How Nudge knows and addresses you.</p></div></div>
          <div className="settings-form">
            <label className="settings-field"><span>Display name</span><input maxLength={80} value={draft.name} onChange={(event) => update("name", event.target.value)} /></label>
            <label className="settings-field"><span>Timezone</span><select value={draft.timezone} onChange={(event) => update("timezone", event.target.value)}>{timezones.map((timezone) => <option key={timezone}>{timezone}</option>)}</select></label>
          </div>
          {saveFooter}
        </article>}

        {section === "assistant" && <article className="settings-card">
          <div className="settings-card-title"><Mic2 size={18} /><div><h3>Assistant</h3><p>Choose Nudge's identity and speaking voice.</p></div></div>
          <div className="settings-form">
            <fieldset className="settings-field"><legend>Assistant gender</legend><div className="settings-segmented">
              {["she", "he"].map((gender) => <button type="button" key={gender} className={draft.assistantGender === gender ? "active" : ""} onClick={() => update("assistantGender", gender)}>{gender === "she" ? "She / her" : "He / him"}</button>)}
            </div></fieldset>
            <label className="settings-field"><span>Voice</span><select value={draft.assistantVoice} onChange={(event) => update("assistantVoice", event.target.value)}>{ASSISTANT_VOICES.map(({ name, tone }) => <option value={name} key={name}>{name} · {tone}</option>)}</select></label>
            <button type="button" className="voice-preview-btn" onClick={previewVoice} disabled={!capabilities.gemini || previewing}>
              {previewing ? <LoaderCircle className="spin" size={15} /> : <Volume2 size={15} />}
              {previewing ? "Playing preview…" : `Preview ${draft.assistantVoice}`}
            </button>
            {!capabilities.gemini && <p className="settings-note">Add a Gemini API key to enable voice controls and previews.</p>}
          </div>
          {saveFooter}
        </article>}

        {section === "notifications" && <article className="settings-card">
          <div className="settings-card-title"><BellRing size={18} /><div><h3>Notifications</h3><p>Control how reminders behave on this device.</p></div></div>
          <button type="button" className="settings-toggle-row" onClick={toggleSound} aria-pressed={soundEnabled}>
            <span><strong>Foreground sound</strong><small>Play the Nudge sound when a reminder arrives while the app is open.</small></span>
            <span className={`settings-switch ${soundEnabled ? "on" : ""}`}><i /></span>
          </button>
          <p className="settings-auto-note"><Check size={13} /> Changes on this page save automatically.</p>
        </article>}

        {section === "capabilities" && <article className="settings-card settings-capabilities">
          <div className="settings-card-title"><Brain size={18} /><div><h3>Capabilities</h3><p>Optional services connected to this Nudge.</p></div></div>
          <div className="capability-list">
            <div className="capability-row"><span><strong>Gemini voice</strong><small>Live conversations and task capture</small></span><b className={capabilities.gemini ? "ready" : "off"}>{capabilities.gemini ? <><Check size={13} /> Ready</> : "Not configured"}</b></div>
            <div className="capability-row"><span><strong>Second Brain</strong><small>Durable memories and semantic recall</small></span><b className={capabilities.secondBrain ? "ready" : "off"}>{capabilities.secondBrain ? <><Check size={13} /> Ready</> : "Not configured"}</b></div>
            <div className="capability-row"><span><strong>Push notifications</strong><small>Due-time reminders on registered devices</small></span><b className={capabilities.push ? "ready" : "off"}>{capabilities.push ? <><Check size={13} /> Ready</> : "Not configured"}</b></div>
            <div className="capability-row"><span><strong>Email assistant</strong><small>Private, on-demand access to connected inboxes</small></span><b className={capabilities.email ? "ready" : "off"}>{capabilities.email ? <><Mail size={13} /> Ready</> : "Not configured"}</b></div>
          </div>
        </article>}
        </div>
      </div>
    </div>
  </section>;
}
