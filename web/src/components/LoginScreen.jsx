import { useState } from "react";
import Logo from "./Logo.jsx";

export default function LoginScreen({ onLogin }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!key) return;
    setLoading(true);
    setError("");
    try {
      await onLogin(key);
      setKey("");
    } catch (err) {
      setError(err.status === 429 ? "Too many attempts. Wait a minute." : "That app key is not valid.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo"><Logo size={26} /> Nudge</div>
        <h1>Your nudge is private.</h1>
        <p>Enter your Nudge app key to continue.</p>
        <label htmlFor="app-key">App key</label>
        <input
          id="app-key"
          type="password"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          autoComplete="current-password"
          autoFocus
        />
        {error && <div className="login-error" role="alert">{error}</div>}
        <button type="submit" disabled={loading || !key}>{loading ? "Unlocking…" : "Unlock Nudge"}</button>
        <small>Your key stays in this request and is never stored in browser storage.</small>
      </form>
    </main>
  );
}
