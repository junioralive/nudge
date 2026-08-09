# Architecture

The Worker serves the PWA and Hono API. D1 is the source of truth for tasks, workspaces, settings, push devices, and notification delivery records. Cron claims due delivery sequences atomically. Each active device receives its own delivery and retry state.

Gemini is optional voice. Second Brain is optional durable memory and semantic recall. Memory failures never block task operations.

Email is an optional Worker-to-Worker integration. Nudge authenticates to Email MCP with a dedicated Cloudflare Access service identity. Nudge stores only stable email-to-task references in D1; mailbox credentials, inbox contents, message bodies, and drafts remain in the Email MCP/mail provider boundary. Email requests are on-demand and never run from Cron.
