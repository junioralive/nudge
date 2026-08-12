# API

All data endpoints require the selected authentication mode. Access mode validates the Cloudflare issuer, audience, expiry, and owner email. Key mode accepts a signed HttpOnly session cookie or, for trusted API clients, the master key as a bearer token. Cookie-authenticated browser mutations require a same-origin `Origin` header.

`GET /api/auth/session` returns `authMode`, identity state, and expiry. `POST /api/auth/login` creates a Key-mode session. `POST /api/auth/logout` clears that session or returns the Cloudflare Access logout URL.

Core endpoints include `GET /api/tasks`, `POST /api/tasks`, `PATCH /api/tasks/:id`, `POST /api/tasks/:id/done`, `GET /api/capabilities`, and `GET /api/health`.

Push endpoints include `GET /api/push/status`, `POST /api/push/subscriptions`, `DELETE /api/push/subscriptions/:deviceId`, `POST /api/push/test`, and `POST /api/push/retry`.

Embedded Memory endpoints include recent, semantic search, capture, detail, update, append, lifecycle status, connections, graph, statistics, grounded Ask Memories, health, configuration, export, idempotent paged import, bounded reindexing, and confirmed deletion under `/api/memories/*`. `POST /api/memories/ask` returns source memory IDs and never stores the question or answer. Restore uses `POST /api/memories/import?offset=&edgeOffset=&limit=`; index state and one-batch rebuilds use `GET` and `POST /api/memories/reindex`.

Email endpoints are available only when the embedded Email KV store and encryption key are configured:

- `GET /api/email/status` and `GET /api/email/accounts`
- `GET /api/email/inbox?accountId=&limit=`
- `POST /api/email/search` and `POST /api/email/message`
- `POST /api/email/drafts` and `POST /api/email/drafts/send`
- `PATCH /api/email/message-state` and `POST /api/email/archive`
- `POST /api/tasks/from-email`
- `POST /api/email/oauth/outlook/start` and `GET /api/email/oauth/outlook/callback`
- `POST /api/email/accounts`, `PATCH /api/email/accounts/:id`, `DELETE /api/email/accounts/:id`, and `POST /api/email/accounts/:id/test`

Inbox and search responses contain signed opaque message references. Mutations use short-lived, single-use approval values returned by those APIs. Sending additionally requires `X-Confirm-Send: true`.

WhatsApp endpoints are available only when the private GOWA bridge URL, Basic Auth credentials, and device ID are configured:

- `GET /api/whatsapp/status`
- `GET /api/whatsapp/chats?search=&limit=&offset=`
- `GET /api/whatsapp/chats/:jid/messages?limit=&offset=`
- `POST /api/whatsapp/messages/prepare`
- `POST /api/whatsapp/messages/send`

The prepare endpoint returns a signed approval for the exact recipient and message. Sending requires that unused approval plus `X-Confirm-Send: true`; approvals expire after ten minutes. WhatsApp has no public MCP endpoint in this release.

Remote MCP endpoints are `POST /email/mcp` and `POST /memories/mcp`. Access mode uses Cloudflare Managed OAuth. Key mode publishes OAuth discovery, dynamic registration, authorization-code + PKCE, token, refresh, and revocation endpoints under `/.well-known/*` and `/oauth/*`. Email and Memories scopes are separate.
