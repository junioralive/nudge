# Architecture

The Worker serves the PWA and Hono API. D1 is the source of truth for tasks, workspaces, settings, push devices, and notification delivery records. Cron claims due delivery sequences atomically. Each active device receives its own delivery and retry state.

Gemini is optional voice. Embedded Memories uses its own `MEMORY_DB`, `MEMORY_VECTORIZE`, `MEMORY_CONFIG_KV`, Workers AI binding, and `MemoriesMCP` Durable Object. It preserves a hard storage boundary from exact task state. Memory failures never block task operations.

Email is an optional in-process module. The Nudge UI, voice allowlist, and `/email/mcp` Durable Object share the same encrypted `EMAIL_KV` account store and native IMAP/SMTP mail service. Nudge stores only stable email-to-task references in D1; mailbox credentials, inbox contents, message bodies, and drafts remain in encrypted KV/mail-provider boundaries. Email requests are on-demand and never run from Cron. Email and Memories MCP use the owner-only Nudge Access audience but retain separate Durable Objects and protocol sessions.

WhatsApp is an optional outbound bridge to a user-hosted GOWA REST server. Nudge stores its HTTPS URL, Basic Auth credentials, and device ID as one encrypted `integration_secrets` record. Chat metadata and message bodies are fetched on demand and are not persisted in Nudge D1, browser storage, or Memories. Sending uses a signed, single-use approval with a ten-minute expiry. WhatsApp does not run from Cron and has no MCP endpoint in this release.
