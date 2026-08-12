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

Optional services are configured after login. Gemini, Microsoft Outlook, Calendar feeds, and WhatsApp are not required to use tasks, reminders, Memories, Email with custom IMAP/SMTP, or push notifications.

## Optional WhatsApp bridge

WhatsApp requires an external, always-on [GOWA](https://github.com/aldinokemal/go-whatsapp-web-multidevice) REST server. It is not provisioned by the Cloudflare setup because WhatsApp Web needs a persistent process and local session storage.

After GOWA is secured behind HTTPS, Basic Auth is enabled, and the phone is linked by QR:

1. Copy the public HTTPS bridge URL.
2. Copy the Basic Auth username and password.
3. Copy the linked GOWA device ID.
4. Open **Settings → Integrations → WhatsApp bridge** in Nudge.
5. Enter all four values, save, and refresh the app.

No WhatsApp value is needed on the Deploy-button screen. See [WhatsApp setup](WHATSAPP.md) for the full procedure and security checklist.

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
