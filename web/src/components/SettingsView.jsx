import { useEffect, useMemo, useState } from "react";
import { BellRing, Brain, Check, Mic2, Settings2, UserRound } from "lucide-react";

const VOICES = [
  ["Zephyr", "Bright"],
  ["Kore", "Firm"],
  ["Puck", "Upbeat"],
  ["Aoede", "Breezy"],
  ["Achird", "Friendly"],
  ["Sulafat", "Warm"],
];

function availableTimezones(current) {
  const defaults = ["UTC", "Asia/Kolkata", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Singapore", "Australia/Sydney"];
  const supported = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : defaults;
  return [...new Set([current, ...defaults, ...supported].filter(Boolean))];
}

export default function SettingsView({ profile, capabilities, onSave }) {
  const [draft, setDraft] = useState(profile);
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem("nudge-sound") !== "off");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const timezones = useMemo(() => availableTimezones(draft.timezone), [draft.timezone]);

  useEffect(() => setDraft(profile), [profile]);

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

  return (
    <section className="settings-view">
      <header className="settings-head">
        <span className="settings-head-icon"><Settings2 size={20} /></span>
        <div><h2>Settings</h2><p>Make Nudge feel like yours.</p></div>
      </header>

      <div className="settings-grid">
        <article className="settings-card">
          <div className="settings-card-title"><UserRound size={17} /><div><h3>Profile</h3><p>How Nudge knows you.</p></div></div>
          <label className="settings-field"><span>Display name</span><input maxLength={80} value={draft.name} onChange={(event) => update("name", event.target.value)} /></label>
          <label className="settings-field"><span>Timezone</span><select value={draft.timezone} onChange={(event) => update("timezone", event.target.value)}>{timezones.map((timezone) => <option key={timezone}>{timezone}</option>)}</select></label>
        </article>

        <article className="settings-card">
          <div className="settings-card-title"><Mic2 size={17} /><div><h3>Assistant</h3><p>Choose Nudge's identity and voice.</p></div></div>
          <fieldset className="settings-field"><legend>Assistant gender</legend><div className="settings-segmented">
            {["she", "he"].map((gender) => <button type="button" key={gender} className={draft.assistantGender === gender ? "active" : ""} onClick={() => update("assistantGender", gender)}>{gender === "she" ? "She / her" : "He / him"}</button>)}
          </div></fieldset>
          <label className="settings-field"><span>Voice</span><select value={draft.assistantVoice} onChange={(event) => update("assistantVoice", event.target.value)}>{VOICES.map(([voice, character]) => <option value={voice} key={voice}>{voice} · {character}</option>)}</select></label>
          {!capabilities.gemini && <p className="settings-note">Add a Gemini API key to enable voice controls.</p>}
        </article>

        <article className="settings-card">
          <div className="settings-card-title"><BellRing size={17} /><div><h3>Notification experience</h3><p>Controls sound while Nudge is open.</p></div></div>
          <button type="button" className="settings-toggle-row" onClick={toggleSound} aria-pressed={soundEnabled}>
            <span><strong>Foreground sound</strong><small>Play the Nudge sound for reminders received while the app is open.</small></span>
            <span className={`settings-switch ${soundEnabled ? "on" : ""}`}><i /></span>
          </button>
        </article>

        <article className="settings-card settings-capabilities">
          <div className="settings-card-title"><Brain size={17} /><div><h3>Capabilities</h3><p>Optional features connected to this Nudge.</p></div></div>
          <div className="capability-row"><span>Gemini voice</span><strong className={capabilities.gemini ? "ready" : "off"}>{capabilities.gemini ? <><Check size={13} /> Ready</> : "Not configured"}</strong></div>
          <div className="capability-row"><span>Second Brain</span><strong className={capabilities.secondBrain ? "ready" : "off"}>{capabilities.secondBrain ? <><Check size={13} /> Ready</> : "Not configured"}</strong></div>
          <div className="capability-row"><span>Push notifications</span><strong className={capabilities.push ? "ready" : "off"}>{capabilities.push ? <><Check size={13} /> Ready</> : "Not configured"}</strong></div>
        </article>
      </div>

      <div className="settings-actions"><span className={status.includes("saved") ? "success" : ""}>{status}</span><button type="button" onClick={save} disabled={saving || !draft.name.trim()}>{saving ? "Saving…" : "Save changes"}</button></div>
    </section>
  );
}
