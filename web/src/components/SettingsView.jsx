import { useEffect, useMemo, useRef, useState } from "react";
import { BellRing, Brain, Check, Download, KeyRound, LoaderCircle, Mail, MessageCircle, Mic2, Plug, ShieldCheck, UserRound, Volume2, X } from "lucide-react";
import { PlaybackQueue } from "../voice/playbackQueue.ts";
import { VoiceConnectionManager } from "../voice/connectionManager.ts";
import { ASSISTANT_VOICES } from "../voice/voiceCatalog.js";
import { downloadRecoveryKit, fetchIntegrations, removeIntegration, saveIntegration } from "../api.js";

function availableTimezones(current) {
  const defaults = ["UTC", "Asia/Kolkata", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Singapore", "Australia/Sydney"];
  const supported = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : defaults;
  return [...new Set([current, ...defaults, ...supported].filter(Boolean))];
}

export default function SettingsView({ authMode, profile, capabilities, onSave, onRestartOnboarding, onClose }) {
  const [draft, setDraft] = useState(profile);
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem("nudge-sound") !== "off");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [section, setSection] = useState("profile");
  const [integrations, setIntegrations] = useState({ gemini: { configured: capabilities.gemini }, microsoft: { configured: capabilities.outlook }, whatsapp: { configured: capabilities.whatsapp } });
  const [geminiKey, setGeminiKey] = useState("");
  const [microsoft, setMicrosoft] = useState({ clientId: "", clientSecret: "", tenant: "organizations" });
  const [whatsapp, setWhatsapp] = useState({ baseUrl: "", username: "", password: "", deviceId: "" });
  const [recoveryKey, setRecoveryKey] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryReauthUrl, setRecoveryReauthUrl] = useState("");
  const previewRef = useRef(null);
  const timezones = useMemo(() => availableTimezones(draft.timezone), [draft.timezone]);

  useEffect(() => setDraft(profile), [profile]);
  useEffect(() => { fetchIntegrations().then(setIntegrations).catch(() => {}); }, []);
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
    ["integrations", Plug, "Integrations"],
    ["recovery", ShieldCheck, "Backup & recovery"],
  ];

  async function downloadRecovery() {
    setRecoveryBusy(true);
    setRecoveryReauthUrl("");
    setStatus("");
    try {
      await downloadRecoveryKit(recoveryKey);
      setRecoveryKey("");
      setStatus("Recovery kit downloaded");
    } catch (error) {
      setRecoveryReauthUrl(error.reauthUrl || "");
      setStatus(error.message || "Could not download recovery kit");
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function configureIntegration(provider) {
    setSaving(true); setStatus("");
    try {
      const values = provider === "gemini" ? { apiKey: geminiKey } : provider === "microsoft" ? microsoft : whatsapp;
      await saveIntegration(provider, values);
      setIntegrations((current) => ({ ...current, [provider]: { configured: true } }));
      if (provider === "gemini") setGeminiKey("");
      else if (provider === "microsoft") setMicrosoft({ clientId: "", clientSecret: "", tenant: microsoft.tenant });
      else setWhatsapp({ baseUrl: "", username: "", password: "", deviceId: "" });
      setStatus(`${provider === "gemini" ? "Gemini" : provider === "microsoft" ? "Microsoft" : "WhatsApp"} connected`);
    } catch (error) { setStatus(error.message || "Could not save integration"); }
    finally { setSaving(false); }
  }

  async function disconnectIntegration(provider) {
    setSaving(true); setStatus("");
    try {
      await removeIntegration(provider);
      setIntegrations((current) => ({ ...current, [provider]: { configured: false } }));
      setStatus(`${provider === "gemini" ? "Gemini" : provider === "microsoft" ? "Microsoft" : "WhatsApp"} removed`);
    } catch (error) { setStatus(error.message || "Could not remove integration"); }
    finally { setSaving(false); }
  }

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
          <button type="button" className="settings-secondary-btn" onClick={onRestartOnboarding}>Run onboarding again</button>
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
            <div className="capability-row"><span><strong>Memories</strong><small>Built-in durable context and semantic recall</small></span><b className={capabilities.secondBrain ? "ready" : "off"}>{capabilities.secondBrain ? <><Check size={13} /> Ready</> : "Not configured"}</b></div>
            <div className="capability-row"><span><strong>Push notifications</strong><small>Due-time reminders on registered devices</small></span><b className={capabilities.push ? "ready" : "off"}>{capabilities.push ? <><Check size={13} /> Ready</> : "Not configured"}</b></div>
            <div className="capability-row"><span><strong>Email assistant</strong><small>Private, on-demand access to connected inboxes</small></span><b className={capabilities.email ? "ready" : "off"}>{capabilities.email ? <><Mail size={13} /> Ready</> : "Not configured"}</b></div>
            <div className="capability-row"><span><strong>WhatsApp assistant</strong><small>Private, on-demand chats through your bridge</small></span><b className={capabilities.whatsapp ? "ready" : "off"}>{capabilities.whatsapp ? <><MessageCircle size={13} /> Ready</> : "Not configured"}</b></div>
          </div>
        </article>}

        {section === "integrations" && <article className="settings-card">
          <div className="settings-card-title"><Plug size={18} /><div><h3>Integrations</h3><p>Optional services. Secrets are encrypted and never shown again.</p></div></div>
          <div className="integration-settings-list">
            <section className="integration-settings-card">
              <div className="integration-settings-head"><span><KeyRound size={16} /><strong>Google Gemini</strong></span><b className={integrations.gemini?.configured ? "ready" : "off"}>{integrations.gemini?.configured ? "Connected" : "Optional"}</b></div>
              <p>Enables live voice conversations and voice previews.</p>
              <label className="settings-field"><span>API key</span><input type="password" autoComplete="off" value={geminiKey} onChange={(event) => setGeminiKey(event.target.value)} placeholder={integrations.gemini?.configured ? "Enter a new key to replace it" : "Google AI Studio API key"} /></label>
              <div className="integration-settings-actions"><button type="button" onClick={() => configureIntegration("gemini")} disabled={saving || !geminiKey.trim()}>Save Gemini</button>{integrations.gemini?.configured && <button type="button" className="settings-secondary-btn" onClick={() => disconnectIntegration("gemini")} disabled={saving}>Remove</button>}</div>
            </section>
            <section className="integration-settings-card">
              <div className="integration-settings-head"><span><MessageCircle size={16} /><strong>WhatsApp bridge</strong></span><b className={integrations.whatsapp?.configured ? "ready" : "off"}>{integrations.whatsapp?.configured ? "Connected" : "Optional"}</b></div>
              <p>Connects Nudge to a private GOWA bridge. Credentials remain encrypted.</p>
              <label className="settings-field"><span>Bridge URL</span><input type="url" autoComplete="off" value={whatsapp.baseUrl} onChange={(event) => setWhatsapp({ ...whatsapp, baseUrl: event.target.value })} placeholder="https://whatsapp.example.com" /></label>
              <label className="settings-field"><span>Username</span><input autoComplete="off" value={whatsapp.username} onChange={(event) => setWhatsapp({ ...whatsapp, username: event.target.value })} placeholder="nudge" /></label>
              <label className="settings-field"><span>Password</span><input type="password" autoComplete="off" value={whatsapp.password} onChange={(event) => setWhatsapp({ ...whatsapp, password: event.target.value })} placeholder={integrations.whatsapp?.configured ? "Enter all values to replace connection" : "Bridge Basic Auth password"} /></label>
              <label className="settings-field"><span>Device ID</span><input autoComplete="off" value={whatsapp.deviceId} onChange={(event) => setWhatsapp({ ...whatsapp, deviceId: event.target.value })} placeholder="GOWA device ID" /></label>
              <div className="integration-settings-actions"><button type="button" onClick={() => configureIntegration("whatsapp")} disabled={saving || !whatsapp.baseUrl.trim() || !whatsapp.username.trim() || !whatsapp.password.trim() || !whatsapp.deviceId.trim()}>Save WhatsApp</button>{integrations.whatsapp?.configured && <button type="button" className="settings-secondary-btn" onClick={() => disconnectIntegration("whatsapp")} disabled={saving}>Remove</button>}</div>
            </section>
            <section className="integration-settings-card">
              <div className="integration-settings-head"><span><Mail size={16} /><strong>Microsoft Outlook</strong></span><b className={integrations.microsoft?.configured ? "ready" : "off"}>{integrations.microsoft?.configured ? "Connected" : "Optional"}</b></div>
              <p>Enables Microsoft account connection. Custom IMAP/SMTP works without this.</p>
              <label className="settings-field"><span>Application client ID</span><input autoComplete="off" value={microsoft.clientId} onChange={(event) => setMicrosoft({ ...microsoft, clientId: event.target.value })} /></label>
              <label className="settings-field"><span>Client secret</span><input type="password" autoComplete="off" value={microsoft.clientSecret} onChange={(event) => setMicrosoft({ ...microsoft, clientSecret: event.target.value })} placeholder={integrations.microsoft?.configured ? "Enter a new secret to replace it" : "Microsoft Entra client secret"} /></label>
              <label className="settings-field"><span>Tenant</span><select value={microsoft.tenant} onChange={(event) => setMicrosoft({ ...microsoft, tenant: event.target.value })}><option value="organizations">Organizations</option><option value="consumers">Personal Microsoft accounts</option><option value="common">Both</option></select></label>
              <div className="integration-settings-actions"><button type="button" onClick={() => configureIntegration("microsoft")} disabled={saving || !microsoft.clientId.trim() || !microsoft.clientSecret.trim()}>Save Microsoft</button>{integrations.microsoft?.configured && <button type="button" className="settings-secondary-btn" onClick={() => disconnectIntegration("microsoft")} disabled={saving}>Remove</button>}</div>
            </section>
          </div>
          {status && <p className={status.includes("connected") || status.includes("removed") ? "success" : "settings-note"}>{status}</p>}
        </article>}

        {section === "recovery" && <article className="settings-card">
          <div className="settings-card-title"><ShieldCheck size={18} /><div><h3>Backup & recovery</h3><p>Keep a copy of the keys required to restore this Nudge installation.</p></div></div>
          <div className="recovery-warning">
            <strong>Plaintext secrets</strong>
            <p>The downloaded JSON can unlock encrypted integrations and push configuration. Store it in a password manager or encrypted drive. Never commit or share it.</p>
          </div>
          <div className="recovery-copy">
            <p><Check size={14} /> Includes deployment keys and configured integration credentials.</p>
            <p><X size={14} /> Does not include tasks, memories, email messages, accounts, or push subscriptions.</p>
          </div>
          {authMode === "key" && <label className="settings-field recovery-key-field"><span>Re-enter Nudge key</span><input type="password" autoComplete="current-password" value={recoveryKey} onChange={(event) => { setRecoveryKey(event.target.value); setStatus(""); }} placeholder="Required to download" /></label>}
          {authMode === "access" && <p className="settings-note recovery-access-note">Cloudflare Access must have verified you within the last five minutes. If requested, sign out and complete email OTP again.</p>}
          {recoveryReauthUrl && <a className="recovery-reauth" href={recoveryReauthUrl} target="_blank" rel="noreferrer">Reauthenticate with Cloudflare Access</a>}
          <div className="recovery-actions">
            <span className={status.includes("downloaded") ? "success" : ""}>{status}</span>
            <button type="button" onClick={downloadRecovery} disabled={recoveryBusy || (authMode === "key" && recoveryKey.length < 15)}>
              {recoveryBusy ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}
              {recoveryBusy ? "Preparing…" : "Download recovery kit"}
            </button>
          </div>
        </article>}
        </div>
      </div>
    </div>
  </section>;
}
