# Troubleshooting

- White page: hard refresh and allow the service worker to update.
- Push unavailable: open Notifications, check browser permission, enable the device, and send a test.
- iPhone/iPad push: install the PWA to the Home Screen first.
- Voice permission: allow microphone persistently in browser site settings; “Allow once” may prompt again by design.
- Optional integrations: check `/api/capabilities` after login.
- Access login loop: confirm the Access application covers `<host>/*`, its Allow policy contains the owner email, and `TEAM_DOMAIN`, `NUDGE_ACCESS_AUD`, and `NUDGE_OWNER_EMAIL` match the application.
- Email hidden: check `/api/capabilities` after Access login and confirm `EMAIL_KV` plus `NUDGE_ENCRYPTION_KEY` (or the temporary legacy key) are configured. Email is intentionally hidden when either is absent.
- MCP authorization failed: confirm the Nudge Access application covers `<host>/*`, Managed OAuth is enabled, `NUDGE_ACCESS_AUD` matches its AUD tag, and its owner-email policy is Allow.
- MCP registration returns `invalid_client_metadata: redirect_uri is not allowed`: add `https://chatgpt.com/*` and/or `https://claude.ai/*` under **Advanced settings → Managed OAuth → Allowed redirect URIs**, then save and recreate the connector.
- Outlook callback failed: register `https://<host>/api/email/oauth/outlook/callback` exactly in Microsoft Entra and keep `OUTLOOK_TENANT` aligned with the account type.
- WhatsApp is missing from navigation: configure all four values under **Settings → Integrations → WhatsApp bridge**, save, then refresh Nudge. The bridge URL must be an HTTPS origin without an API path.
- WhatsApp connection needs attention: open GOWA and confirm the device is connected and logged in. Re-link the phone by QR if its session expired.
- WhatsApp authentication failed: confirm the GOWA Basic Auth username and password. Enter values only, without `Authorization:` or header-name prefixes.
- WhatsApp service unavailable: confirm the HTTPS hostname is reachable from the public internet, its certificate is valid, GOWA is running in REST mode, and the local port is reachable through the reverse proxy.
- WhatsApp chats are empty: confirm the configured device ID exactly matches the linked GOWA device. GOWA v8+ device-scoped requests require `X-Device-Id` unless only one device exists.
