# API

All data endpoints require a valid Cloudflare Access assertion. The Worker validates the Access issuer, audience, expiry, and configured owner email. Browser mutations also require a same-origin `Origin` header.

`GET /api/auth/session` returns the verified Access email and token expiry. `POST /api/auth/logout` returns the Cloudflare Access logout URL. There is no Nudge password or bearer-key login.

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

Remote MCP endpoints are `POST /email/mcp` and `POST /memories/mcp`. Both use Managed OAuth on the same owner-only Access application and `NUDGE_ACCESS_AUD` as normal Nudge APIs.
