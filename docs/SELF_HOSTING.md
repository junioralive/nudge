# Self-hosting Nudge

## Guided deployment

The supported first-run path is:

```sh
npm install
npx wrangler login
npm run setup:cloudflare
```

The setup wizard asks for the Worker name, owner email, Cloudflare Access team/account details, optional custom domain, profile settings, optional Gemini/Second Brain credentials, Microsoft Entra credentials, and an existing Email KV namespace ID when migrating.

It provisions or reuses D1 and Email KV, creates one Access application covering `/*` with its owner policy, enables email OTP and Managed OAuth, generates VAPID/encryption/action secrets, applies migrations, seeds the profile, and deploys the Worker. The temporary Cloudflare API token is used in memory only and is never saved.

If no custom domain is chosen, use the `workers.dev` URL printed at the end. If a custom domain is chosen, Cloudflare must have the domain in the same account and DNS must be available for the custom Worker domain.

## After deployment

1. Open the printed URL.
2. Complete the Cloudflare Access email OTP.
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

Until the public repository URL exists, the guided setup command is the equivalent one-command deployment path. For a Git-connected deployment use the root commands `npm run cloudflare:build` and `npm run cloudflare:deploy`; do not run `npx wrangler deploy` from the workspace root because the Vite plugin must target the `web` application.

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
