# Self-hosting Nudge

## Guided deployment

The supported first-run path is:

```sh
npm install
npx wrangler login
npm run setup:cloudflare
```

The setup wizard asks for the Worker name, profile name, timezone, assistant pronouns, optional custom domain, initial workspaces, and optional Gemini, Second Brain, and Email MCP integrations.

Email setup requires a Cloudflare Access service token created for the separately deployed Email MCP server. See [Email assistant](EMAIL.md).

It provisions or reuses D1, generates the login/session/VAPID credentials, applies migrations, seeds the profile, and deploys the Worker. The generated login key is saved locally to `NUDGE_LOGIN_KEY.txt`; copy it into your password manager and do not commit it.

If no custom domain is chosen, use the `workers.dev` URL printed at the end. If a custom domain is chosen, Cloudflare must have the domain in the same account and DNS must be available for the custom Worker domain.

## After deployment

1. Open the printed URL.
2. Sign in with the generated login key.
3. Open Notifications.
4. Install Nudge as a PWA where desired.
5. Click Enable notifications on every device.
6. Send a test notification.

iPhone and iPad users must install Nudge to the Home Screen before requesting push permission. Background notification sound is controlled by iOS; the app cannot force a custom MP3 while closed.

## Optional SQLite import

If you have a legacy `nudge.db` backup:

```sh
npm run migrate:sqlite
```

The import is idempotent and leaves the SQLite file untouched.

## One-click deployment

Cloudflare’s Deploy to Workers button requires a public GitHub repository URL. Once Nudge is published, use:

```text
https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR_OWNER/nudge
```

Until the public repository URL exists, the guided setup command is the equivalent one-command deployment path.

## Updating

```sh
npm test
npm run typecheck
npm run build
npm run deploy
```

Migrations are applied separately when a new migration is added:

```sh
cd web
npx wrangler d1 migrations apply DB --remote
```
