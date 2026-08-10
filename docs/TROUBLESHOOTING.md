# Troubleshooting

- White page: hard refresh and allow the service worker to update.
- Push unavailable: open Notifications, check browser permission, enable the device, and send a test.
- iPhone/iPad push: install the PWA to the Home Screen first.
- Voice permission: allow microphone persistently in browser site settings; “Allow once” may prompt again by design.
- Optional integrations: check `/api/capabilities` after login.
- Access login loop: confirm the Access application covers `<host>/*`, its Allow policy contains the owner email, and `TEAM_DOMAIN`, `NUDGE_ACCESS_AUD`, and `NUDGE_OWNER_EMAIL` match the application.
- Email hidden: check `/api/capabilities` after Access login and confirm `EMAIL_KV` plus `CREDENTIAL_ENCRYPTION_KEY` are configured. Email is intentionally hidden when either is absent.
- MCP authorization failed: confirm Managed OAuth is enabled on the Access application covering `<host>/*` and its owner-email policy is Allow. Reconnect ChatGPT or Claude to `https://<host>/email/mcp`.
- Outlook callback failed: register `https://<host>/api/email/oauth/outlook/callback` exactly in Microsoft Entra and keep `OUTLOOK_TENANT` aligned with the account type.
