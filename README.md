# Nudge

> **Your private AI assistant for tasks, memory, and follow-ups.**

Nudge is a self-hosted personal assistant for capturing work, remembering what matters, and following up at the right time. It is a polished React PWA backed by one Cloudflare Worker, with D1 for operational data and optional AI services for voice and memory.

[![CI](https://github.com/junioralive/nudge/actions/workflows/ci.yml/badge.svg)](https://github.com/junioralive/nudge/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-7c3aed.svg)](LICENSE)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/junioralive/nudge)

## Why Nudge

Most task apps help you record work. Nudge helps you keep momentum.

- Capture tasks by typing or voice.
- Keep full context, deadlines, workspaces, and follow-ups together.
- Receive privacy-safe reminders on every enabled device.
- Review completed work without mixing it into your active agenda.
- Add Gemini voice assistance and Second Brain recall only when you want them.

Nudge is useful without either integration. Core tasks, authentication, D1 storage, PWA install, and push reminders remain fully independent.

## Product preview

![Nudge dashboard](docs/images/nudge-dashboard.png)

The interface keeps the active agenda quiet, makes workspaces easy to scan, and keeps completed history one click away.

## What it looks like

Nudge is designed as a focused, single-user workspace:

| Area | Purpose |
| --- | --- |
| Today | See what needs attention now. |
| All tasks | Search and manage open work across workspaces. |
| Completed | Keep a durable history of finished work. |
| Memories | Optional semantic recall from Second Brain. |
| Voice | Optional Gemini assistant for hands-free capture and recall. |

## Architecture

```mermaid
flowchart LR
  Browser[React PWA] --> Worker[Cloudflare Worker + Hono]
  Worker --> D1[(Cloudflare D1)]
  Worker --> Cron[One-minute Cron]
  Cron --> Push[Web Push]
  Worker -. optional .-> Gemini[Gemini]
  Worker -. optional .-> Brain[Second Brain]
```

### Data ownership

- **Nudge D1** stores tasks, details, workspaces, profile settings, reminders, delivery state, and push subscriptions.
- **Second Brain** stores durable memories only when the optional integration is enabled and a memory action is explicit or approved by the assistant.
- **Gemini** handles optional voice sessions and spoken task capture. Nudge uses the configured live model only; reminders use the saved task text and do not make extra Gemini calls.
- Raw audio, transcripts, assistant output, credentials, tokens, and private keys are not saved as memories.

## Deploy on Cloudflare

### Fastest path

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/junioralive/nudge)

Cloudflare clones the repository, shows the fields declared in `.dev.vars.example`, provisions D1, deploys the Worker, and applies its migrations. Field descriptions come from `package.json`; secret values are encrypted by Cloudflare and are not committed to the generated repository.

For the terminal-based guided setup instead:

```sh
npm install
npx wrangler login
npm run setup:cloudflare
```

The setup wizard asks for:

- Worker name and optional custom domain
- Your owner email, Cloudflare Access team domain, account ID, and temporary `Access: Apps and Policies Write` API token
- Your display name, timezone, assistant gender (`she` or `he`), and initial workspaces
- Optional Gemini, Second Brain, and Microsoft Entra credentials
- An existing Email KV namespace ID when migrating an Email MCP deployment (otherwise one is created)

It then creates or reuses D1 and Email KV, provisions one Cloudflare Access application covering `/*`, configures email OTP and Managed OAuth, generates VAPID/encryption/action secrets, applies migrations, seeds your profile, and deploys. Gemini and Second Brain are **off by default**. The temporary Cloudflare API token is held in memory only and is never written to disk, Worker secrets, or logs.

If you skip a custom domain, Cloudflare keeps the `workers.dev` URL available.

#### Cloudflare Workers Builds

For a Git-connected deployment, keep the repository root as `/` and set these two commands in **Settings → Builds → Build configurations**:

```text
Build command:  npm run cloudflare:build
Deploy command: npm run cloudflare:deploy
```

The repository includes a root `wrangler.jsonc` so Cloudflare can detect the project without workspace auto-detection. Keep the build and deploy commands above so Vite generates the final Worker bundle, deploys it, and applies D1 migrations.

## Local development

Requirements: Node.js 22+, npm, and a Cloudflare account for deployment.

```sh
npm install
npm run dev
```

For local secrets, copy `web/.dev.vars.example` to `web/.dev.vars` and use development-only values. Never commit that file.

## Configuration

Required Worker configuration:

- `TEAM_DOMAIN`, `NUDGE_ACCESS_AUD`, and `NUDGE_OWNER_EMAIL` — configured by the setup wizard for Cloudflare Access
- `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` — generated automatically for Web Push delivery
- `CREDENTIAL_ENCRYPTION_KEY` — generated for new Email KV stores; reuse the existing value during migration
- `NUDGE_ACTION_SIGNING_SECRET` — generated for one-time browser email approvals

Optional secrets:

- `GEMINI_API_KEY` — enables the voice assistant
- `SECOND_BRAIN_URL` — connects your deployed Second Brain
- `SECOND_BRAIN_TOKEN` — enables memory capture and recall

Configuration variables include `APP_TIMEZONE`, `NUDGE_PROFILE_NAME`, and `VAPID_SUBJECT`. The app uses one maintained Gemini Live model. Assistant gender, voice, timezone, and display name are changed inside Nudge Settings. `NUDGE_AUTH_KEY` and `SESSION_SECRET` are not used.

## Optional integrations

Nudge is deliberately useful without external AI. Add these integrations only when you want their specific capabilities.

### Gemini — voice and assistant intelligence

[Google AI Studio](https://ai.google.dev/aistudio) is where you create and manage a Gemini API key. Gemini powers Nudge's optional live voice assistant, structured task capture, and memory-tool decisions. It does not own your task database, and the key stays server-side in Cloudflare. Reminders do not call Gemini separately.

Setup:

1. Open [Google AI Studio](https://aistudio.google.com/).
2. Create an API key from the [Gemini API key page](https://aistudio.google.com/app/apikey).
3. Enable Gemini in `npm run setup:cloudflare`, or add the secret manually:

   ```sh
   npx wrangler secret put GEMINI_API_KEY
   ```

Without Gemini, Nudge keeps task management and standard reminders working and hides voice controls.

### Second Brain — durable memory and semantic recall

[Second Brain Cloudflare](https://github.com/rahilp/second-brain-cloudflare) is an optional, separate memory layer. It is useful for durable preferences, decisions, people, and project context that should be recalled across conversations. Nudge remains the source of truth for exact task state; Second Brain is never required for tasks or reminders.

Setup:

1. Deploy your own Second Brain instance from its repository.
2. Copy its base URL and API token.
3. Enable Second Brain in `npm run setup:cloudflare`, or configure `SECOND_BRAIN_URL` and the `SECOND_BRAIN_TOKEN` secret manually.

Without Second Brain, Nudge hides Memories and skips recall without delaying task operations. Nudge never sends the token to the browser.

You can enable either integration independently, or use both together.

### Email — inbox and MCP

Email is embedded in the Nudge Worker. It uses the encrypted `EMAIL_KV` mailbox store and supports Outlook OAuth plus custom IMAP/SMTP accounts. Nudge never stores mailbox credentials or message bodies in D1, the browser, Gemini context outside an explicit request, or Second Brain.

The permanent MCP endpoint is:

```text
https://<your-nudge-host>/email/mcp
```

The Access application covering `/*` also enables Managed OAuth with 15-minute access tokens, 24-hour grant sessions, dynamic client registration, and localhost/loopback disabled. In ChatGPT or Claude, add the URL as a remote MCP server and complete the Cloudflare email OTP flow. Register this Microsoft Entra redirect URI:

```text
https://<your-nudge-host>/api/email/oauth/outlook/callback
```

Keep the old standalone Email MCP Worker online during migration. Reconnect MCP clients to the new endpoint only after inbox and reviewed-send acceptance tests pass.

## Security model

Nudge is intentionally single-user and private by default.

- All data APIs require authentication.
- Browser mutations require same-origin requests.
- Cloudflare Access validates the issuer, audience, expiry, and owner email on every request; browser access uses email OTP.
- The main Nudge and `/email/mcp*` applications have separate audiences and 24-hour sessions.
- Managed OAuth uses short-lived 15-minute MCP access tokens and 24-hour grant sessions.
- Voice endpoints are rate-limited.
- Service-worker caches contain application assets only, never authenticated API responses.
- Secrets stay in Cloudflare Worker secrets and are never sent to frontend code.

Read the [security guide](docs/SECURITY.md) before exposing an installation publicly. Enable GitHub secret scanning, push protection, Dependabot, and code scanning for public forks.

## Commands

```sh
npm run setup:cloudflare  # guided first deployment
npm run dev               # local development
npm test                  # focused Worker tests
npm run typecheck         # Wrangler types + TypeScript
npm run build             # production PWA/Worker build
npm run deploy            # deploy configured Worker
npm run migrate:sqlite    # optional legacy SQLite import
```

## Documentation

- [Self-hosting](docs/SELF_HOSTING.md)
- [Architecture and data ownership](docs/ARCHITECTURE.md)
- [REST API](docs/API.md)
- [Push and PWA setup](docs/PUSH.md)
- [Security and responsible disclosure](docs/SECURITY.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## Contributing

Small, focused pull requests are welcome. Before opening one, run:

```sh
npm test
npm run typecheck
npm run build
npm audit --omit=dev
```

Please do not include local databases, `.dev.vars`, API keys, login-key exports, or personal deployment configuration in commits.

## License

MIT © Nudge contributors
