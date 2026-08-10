# Self-hosting Nudge

## Guided deployment

The supported first-run path is:

```sh
npm install
npx wrangler login
npm run setup:cloudflare
```

The setup wizard first offers Nudge Key or Cloudflare Zero Trust. Key mode asks for a masked private key of at least 15 characters and needs no Access account. Zero Trust asks for the owner email and a temporary Cloudflare API token. Use `--domain`, `--worker-name`, or `--redirect-uri` for advanced deployments.

It provisions or reuses consistently named `nudge-*` resources, generates VAPID/encryption/action secrets, applies migrations, and deploys. Access applications are created only for Zero Trust. Key mode supplies Nudge's built-in scoped OAuth for both MCP paths.

If no custom domain is chosen, use the `workers.dev` URL printed at the end. If a custom domain is chosen, Cloudflare must have the domain in the same account and DNS must be available for the custom Worker domain.

## After deployment

1. Open the printed URL.
2. Enter the Nudge key, or complete Cloudflare Access email OTP, according to the selected mode.
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
