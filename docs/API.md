# API

All data endpoints require the signed session cookie or `Authorization: Bearer <NUDGE_AUTH_KEY>`.

Core endpoints include `GET /api/tasks`, `POST /api/tasks`, `PATCH /api/tasks/:id`, `POST /api/tasks/:id/done`, `GET /api/capabilities`, and `GET /api/health`.

Push endpoints include `GET /api/push/status`, `POST /api/push/subscriptions`, `DELETE /api/push/subscriptions/:deviceId`, `POST /api/push/test`, and `POST /api/push/retry`.

Memory endpoints are available only when Second Brain is configured: `/api/memories/recent`, `/api/memories/search`, `POST /api/memories`, and `DELETE /api/memories/:id`.
