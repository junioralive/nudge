# Security

Nudge is single-user, not a multi-tenant service. Cloudflare Access email OTP is the browser authentication layer. Keep Access audiences, VAPID, encryption, OAuth, and action-signing secrets in Cloudflare Secrets, rotate any secret that has been exposed, keep `.dev.vars` private, and never log subscription JSON, memory content, task text, or credentials.

The Worker verifies the Cloudflare Access issuer, JWKS signature, audience, expiry, and configured owner email on every request. The normal Nudge and `/email/mcp` routes use different Access audiences. Browser mutations require a same-origin request. Managed OAuth MCP tokens are short-lived and refreshed by the MCP client under the Access policy.

Second Brain and Gemini are optional. Their tokens never enter frontend code. Routine tasks, completed tasks, raw audio, transcripts, assistant output, and credentials are not automatically stored as memories.

Email is optional and uses an embedded mail service plus a path-specific Cloudflare Access MCP application. Nudge stores no mailbox credentials in D1. The encrypted Email KV record is the source of truth, mutations require short-lived signatures bound to the exact action, and email bodies are fetched only after explicit user intent. They are never automatically copied to D1 or Second Brain.

Report security issues privately before public disclosure.
