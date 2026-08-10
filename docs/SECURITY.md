# Security

Nudge is single-user, not a multi-tenant service. It supports Cloudflare Access email OTP or a private Nudge key. Keep keys, Access values, VAPID, encryption, OAuth, and action-signing secrets in Cloudflare Secrets, rotate any exposed secret, keep `.dev.vars` private, and never log subscription JSON, memory content, task text, or credentials.

In Access mode the Worker verifies issuer, JWKS signature, `NUDGE_ACCESS_AUD`, expiry, and owner email. In Key mode it requires a 15+ character key, compares hashes in constant time, throttles login attempts, and signs a Secure, HttpOnly, SameSite=Strict session cookie using key material derived from the key and encryption secret. Rotating the key invalidates sessions. MCP clients receive scoped short-lived OAuth tokens, never the master key. Complete Access always wins in `auto` mode.

Memories is embedded and uses Workers AI without a user API key. Gemini remains optional for live voice. Routine tasks, completed tasks, raw audio, transcripts, assistant output, email bodies, and credentials are not automatically stored as memories.

Email is optional and uses an embedded mail service protected by the main Cloudflare Access application. Nudge stores no mailbox credentials in D1. The encrypted Email KV record is the source of truth, mutations require short-lived signatures bound to the exact action, and email bodies are fetched only after explicit user intent. They are never automatically copied to D1 or Memories.

Report security issues privately before public disclosure.
