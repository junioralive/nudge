# API

All data endpoints require the signed session cookie or `Authorization: Bearer <NUDGE_AUTH_KEY>`.

Core endpoints include `GET /api/tasks`, `POST /api/tasks`, `PATCH /api/tasks/:id`, `POST /api/tasks/:id/done`, `GET /api/capabilities`, and `GET /api/health`.

Push endpoints include `GET /api/push/status`, `POST /api/push/subscriptions`, `DELETE /api/push/subscriptions/:deviceId`, `POST /api/push/test`, and `POST /api/push/retry`.

Memory endpoints are available only when Second Brain is configured: `/api/memories/recent`, `/api/memories/search`, `POST /api/memories`, and `DELETE /api/memories/:id`.

Email endpoints are available only when Email MCP and its Access service token are configured:

- `GET /api/email/status` and `GET /api/email/accounts`
- `GET /api/email/inbox?accountId=&limit=`
- `POST /api/email/search` and `POST /api/email/message`
- `POST /api/email/drafts` and `POST /api/email/drafts/send`
- `PATCH /api/email/message-state` and `POST /api/email/archive`
- `POST /api/tasks/from-email`

Inbox and search responses contain signed opaque message references. Mutations use short-lived, single-use approval values returned by those APIs. Sending additionally requires `X-Confirm-Send: true`.
