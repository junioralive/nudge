import { useState } from "react";
import Logo from "./Logo.jsx";

export default function LoginScreen({ authMode, configurationError, reauthRequired, onLogin }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function continueWithEmail() {
    const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    window.location.assign(`/cdn-cgi/access/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await onLogin(key);
      setKey("");
    } catch (requestError) {
      setError(requestError.message || "Could not unlock Nudge");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-logo"><Logo size={26} /> Nudge</div>
        <h1 id="login-title">Your nudge is private.</h1>
        {authMode === "key" ? (
          <form className="login-form" onSubmit={submit}>
            <p>Enter your private Nudge key to continue.</p>
            <label htmlFor="nudge-key">Nudge key</label>
            <input id="nudge-key" type="password" value={key} minLength={15} autoComplete="current-password" onChange={(event) => setKey(event.target.value)} required autoFocus />
            {error && <span className="login-error" role="alert">{error}</span>}
            <button type="submit" disabled={submitting || key.length < 15}>{submitting ? "Unlocking…" : "Unlock Nudge"}</button>
            <small>Your key stays on this device only long enough to create a secure session.</small>
          </form>
        ) : authMode === "access" ? (
          <>
            <p>{reauthRequired ? "Your session expired. Verify your email to continue." : "Continue with your email to open Nudge."}</p>
            <button type="button" onClick={continueWithEmail}>{reauthRequired ? "Sign in again" : "Continue with email"}</button>
            <small>{reauthRequired ? "You’ll receive a fresh Cloudflare Access verification code." : "Cloudflare Access protects this private workspace with an email verification code."}</small>
          </>
        ) : (
          <>
            <p>Nudge authentication is not configured.</p>
            <small>{configurationError || "Set AUTH_MODE and its required deployment credentials."}</small>
          </>
        )}
      </section>
    </main>
  );
}
