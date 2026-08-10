import Logo from "./Logo.jsx";

export default function LoginScreen() {
  function continueWithEmail() {
    const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    window.location.assign(`/cdn-cgi/access/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-logo"><Logo size={26} /> Nudge</div>
        <h1 id="login-title">Your nudge is private.</h1>
        <p>Continue with your email to open Nudge.</p>
        <button type="button" onClick={continueWithEmail}>Continue with email</button>
        <small>Cloudflare Access protects this private workspace with an email verification code.</small>
      </section>
    </main>
  );
}
