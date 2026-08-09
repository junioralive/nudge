# Security

Nudge is single-user, not a multi-tenant service. Choose a strong `NUDGE_AUTH_KEY`, keep the automatically generated session and VAPID values in Cloudflare Secrets, rotate any secret that has been exposed, keep `.dev.vars` private, and never log subscription JSON, memory content, task text, or credentials.

The login endpoint is rate-limited. Voice sessions are separately rate-limited. Browser mutations require a same-origin request, and API clients must use the bearer key over HTTPS. Sessions are signed with `SESSION_SECRET` and expire after 30 days; rotating that secret invalidates existing sessions.

Second Brain and Gemini are optional. Their tokens never enter frontend code. Routine tasks, completed tasks, raw audio, transcripts, assistant output, and credentials are not automatically stored as memories.

Report security issues privately before public disclosure.
