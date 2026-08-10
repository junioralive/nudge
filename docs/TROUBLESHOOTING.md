# Troubleshooting

- White page: hard refresh and allow the service worker to update.
- Push unavailable: open Notifications, check browser permission, enable the device, and send a test.
- iPhone/iPad push: install the PWA to the Home Screen first.
- Voice permission: allow microphone persistently in browser site settings; “Allow once” may prompt again by design.
- Optional integrations: check `/api/capabilities` after login.
- Access login loop: confirm the Access application covers `<host>/*`, its Allow policy contains the owner email, and `TEAM_DOMAIN`, `NUDGE_ACCESS_AUD`, and `NUDGE_OWNER_EMAIL` match the application.
- Email hidden: check `/api/capabilities` after Access login and confirm `EMAIL_KV` plus `NUDGE_ENCRYPTION_KEY` (or the temporary legacy key) are configured. Email is intentionally hidden when either is absent.
- MCP authorization failed: confirm the shared MCP Access application covers both `<host>/email/mcp*` and `<host>/memories/mcp*`, Managed OAuth is enabled, `MCP_ACCESS_AUD` matches its AUD tag, and its owner-email policy is Allow.
- MCP registration returns `invalid_client_metadata: redirect_uri is not allowed`: add `https://chatgpt.com/*` and/or `https://claude.ai/*` under **Advanced settings → Managed OAuth → Allowed redirect URIs**, then save and recreate the connector.
- Outlook callback failed: register `https://<host>/api/email/oauth/outlook/callback` exactly in Microsoft Entra and keep `OUTLOOK_TENANT` aligned with the account type.
