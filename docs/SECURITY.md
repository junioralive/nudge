# Security

Nudge is single-user, not a multi-tenant service. It supports Cloudflare Access email OTP or a private Nudge key. Keep keys, Access values, VAPID, encryption, OAuth, and action-signing secrets in Cloudflare Secrets, rotate any exposed secret, keep `.dev.vars` private, and never log subscription JSON, memory content, task text, or credentials.

In Access mode the Worker verifies issuer, JWKS signature, `NUDGE_ACCESS_AUD`, expiry, and owner email. In Key mode it requires a 15+ character key, compares hashes in constant time, throttles login attempts, and signs a Secure, HttpOnly, SameSite=Strict session cookie using key material derived from the key and encryption secret. Rotating the key invalidates sessions. MCP clients receive scoped short-lived OAuth tokens, never the master key. Complete Access always wins in `auto` mode.

Memories is embedded and uses Workers AI without a user API key. Gemini remains optional for live voice. Routine tasks, completed tasks, raw audio, transcripts, assistant output, email bodies, and credentials are not automatically stored as memories.

Email is optional and uses an embedded mail service protected by the main Cloudflare Access application. Nudge stores no mailbox credentials in D1. The encrypted Email KV record is the source of truth, mutations require short-lived signatures bound to the exact action, and email bodies are fetched only after explicit user intent. They are never automatically copied to D1 or Memories.

WhatsApp is optional and uses a user-hosted GOWA bridge. Use a dedicated or low-risk WhatsApp account where practical: GOWA is an unofficial WhatsApp Web automation project and may be affected by provider changes or account policy enforcement. Protect the bridge with valid HTTPS, a strong unique Basic Auth password, persistent encrypted backups, and a firewall or reverse proxy that prevents direct access to its local port. A random hostname is useful for reducing noise but is not an authentication control.

The four WhatsApp connection values are encrypted before storage in D1. Nudge sends Basic Auth and `X-Device-Id` only to the configured HTTPS origin. Chat lists and messages are fetched only on explicit use, message content is not logged or cached by Nudge, and every send requires a visible single-use approval. Never reuse the GOWA password for Nudge authentication or another service.

## Recovery kit

Settings → Backup & recovery can download the deployment keys needed to restore encrypted integrations and push configuration. Key mode requires the master Nudge key again. Access mode requires a Cloudflare Access assertion issued within the previous five minutes; older sessions are directed through Cloudflare reauthentication.

The recovery kit is plaintext JSON by explicit design. The response is an attachment with `no-store` caching directives, and the browser does not place it in local storage. Treat the downloaded file like a master password: keep it in a password manager or encrypted drive, never commit it, and delete unsecured copies. It does not contain D1 tasks, Memories, Email KV account records, messages, or push subscriptions; back up those stores separately.

Report security issues privately before public disclosure.
