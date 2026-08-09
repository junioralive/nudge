# Nudge

Nudge is a private, single-user assistant for tasks, deadlines, workspaces, voice capture, completed-task history, and reliable push reminders.

It runs as one Cloudflare Worker:

```text
React PWA + Hono API + D1 + Cron + Web Push
```

Nudge works without AI services. Gemini, Second Brain, and private email are optional enhancements.

![Nudge dashboard](docs/images/nudge-dashboard.png)

## What Nudge stores

- Tasks, full details, due dates, workspaces, and completion history in D1
- Notification schedules and delivery state in D1
- Push subscriptions for devices you explicitly enable
- Durable memories only in Second Brain when you explicitly save them or use an approved memory action

Routine tasks, completed-task history, raw audio, transcripts, assistant replies, credentials, and tokens are not stored as memories.

## Features

- Single-user login with a secure signed session cookie
- Today, All tasks, and Completed history views
- Workspaces, search, deadlines, task details, editing, and follow-up reminders
- PWA install support for desktop, Android, and iPhone/iPad Home Screen apps
- Push notifications with multi-device delivery and retries
- Optional Gemini voice assistant
- Optional Second Brain memory and semantic recall
- Optional multi-account email search, reading, reviewed drafts, and confirmed sending
- Cloudflare D1 backup-friendly data model

## Fast setup

Requirements: Node.js 22+, a Cloudflare account, and Wrangler authentication.

```sh
npm install
npx wrangler login
npm run setup:cloudflare
```

The guided setup asks for:

- Worker name
- Your profile name
- Timezone
- Assistant pronouns (`she` or `he`)
- Optional custom domain
- Initial workspaces
- Optional Gemini enablement
- Optional Second Brain enablement and URL
- Optional private Email MCP connection

`web/wrangler.example.jsonc` is the neutral template for a public fork. Replace any deployment-specific values in `web/wrangler.jsonc` before publishing an existing installation.

It then:

1. Creates or reuses a D1 database.
2. Generates the login key, session secret, and VAPID keys.
3. Stores secrets in Cloudflare, never in the repository.
4. Applies every D1 migration.
5. Seeds your profile and workspaces.
6. Builds and deploys once.

The generated login key is written to `NUDGE_LOGIN_KEY.txt` with local-only permissions. Keep it private.

If no custom domain is supplied, the app remains available on the Worker URL. After login, open Notifications and explicitly enable each device.

### One-click Cloudflare deploy

Cloudflare’s Deploy to Workers button can be added as soon as this project is published to a public GitHub repository:

```text
https://deploy.workers.cloudflare.com/?url=https://github.com/junioralive/nudge
```

The button opens Cloudflare’s guided deployment flow. `npm run setup:cloudflare` remains the complete one-command setup when you want automatic secret generation, D1 provisioning, optional integrations, and profile seeding.

## Local development

```sh
npm install
npm run dev
```

Optional local secrets go in `web/.dev.vars`:

```dotenv
NUDGE_AUTH_KEY=local-development-key
SESSION_SECRET=local-session-secret
VAPID_PUBLIC_KEY=local-public-key
VAPID_PRIVATE_KEY=local-private-key
# GEMINI_API_KEY=optional
# SECOND_BRAIN_TOKEN=optional
```

## Configuration

Core secrets:

- `NUDGE_AUTH_KEY`
- `SESSION_SECRET`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`

Optional secrets:

- `GEMINI_API_KEY`
- `SECOND_BRAIN_TOKEN`
- `EMAIL_ACCESS_CLIENT_ID`
- `EMAIL_ACCESS_CLIENT_SECRET`
- `EMAIL_ACTION_SIGNING_SECRET`

Configuration variables:

- `APP_TIMEZONE` — default `Asia/Kolkata`
- `VAPID_SUBJECT` — HTTPS URL or mailto subject
- `SECOND_BRAIN_URL` — only required when memories are enabled
- `EMAIL_MCP_URL` — only required when private email is enabled
- `NUDGE_ASSISTANT_GENDER` — `she` or `he`
- `GEMINI_LIVE_MODEL` — configurable voice model ID

Never commit `.dev.vars`, local databases, login-key exports, API keys, or private keys.

## Commands

```sh
npm run setup:cloudflare  # guided first deployment
npm run dev               # local app
npm test                  # focused tests
npm run typecheck         # Worker and TypeScript checks
npm run build             # production build
npm run deploy            # deploy an already configured Worker
npm run migrate:sqlite    # optional legacy SQLite import
```

## Security model

Nudge is intentionally single-user. All data APIs require authentication. Browser mutations require same-origin requests. Sessions are HttpOnly, Secure, and SameSite=Strict. Service-worker caches contain application assets only and never authenticated API responses.

Tasks remain in D1. Second Brain is a separate, optional memory service. Nudge never sends its token or Gemini key to frontend code.

See:

- [Architecture and data ownership](docs/ARCHITECTURE.md)
- [Self-hosting](docs/SELF_HOSTING.md)
- [REST API](docs/API.md)
- [Push and PWA setup](docs/PUSH.md)
- [Private email assistant](docs/EMAIL.md)
- [Security](docs/SECURITY.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## Release checks

Before publishing a release, run:

```sh
npm test
npm run typecheck
npm run build
npm audit --omit=dev
```

Then verify login, task CRUD, completed history, one real push notification, and one real Second Brain capture on a clean deployment.

## License

MIT — Nudge contributors.
