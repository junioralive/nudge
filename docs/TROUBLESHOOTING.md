# Troubleshooting

- White page: hard refresh and allow the service worker to update.
- Push unavailable: open Notifications, check browser permission, enable the device, and send a test.
- iPhone/iPad push: install the PWA to the Home Screen first.
- Voice permission: allow microphone persistently in browser site settings; “Allow once” may prompt again by design.
- Optional integrations: check `/api/capabilities` after login.
- Email hidden: configure `EMAIL_MCP_URL`, `EMAIL_ACCESS_CLIENT_ID`, and `EMAIL_ACCESS_CLIENT_SECRET` on Nudge.
- Email authorization failed: confirm the service token is included in a Cloudflare Access `Service Auth` policy and that its Client ID matches `NUDGE_ACCESS_CLIENT_ID` on Email MCP.
- Email actions unavailable: install the same `EMAIL_ACTION_SIGNING_SECRET`/`NUDGE_ACTION_SIGNING_SECRET` value on the two Workers.
