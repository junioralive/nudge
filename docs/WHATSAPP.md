# WhatsApp bridge

WhatsApp is an optional Nudge integration. Core Nudge, tasks, reminders, Memories, Email, Calendar, push, and PWA installation work without it.

Nudge does not run WhatsApp Web inside Cloudflare. It connects to [GOWA](https://github.com/aldinokemal/go-whatsapp-web-multidevice), an always-on REST bridge running on your own VPS or Docker host. GOWA supports multiple linked devices and requires device-scoped requests in current releases.

## What you need

- A working Nudge deployment.
- An always-on Linux VPS or Docker host.
- A hostname with valid HTTPS, such as `https://chat-bridge.example.com`.
- A strong, unique GOWA Basic Auth username and password.
- A WhatsApp account that can scan the GOWA QR code.
- The device ID shown after the account is linked.

You do **not** need to enter WhatsApp values during Nudge's Cloudflare deployment or first-login onboarding.

## 1. Deploy GOWA

Follow the official [GOWA Docker instructions](https://github.com/aldinokemal/go-whatsapp-web-multidevice#docker-you-dont-need-to-install-in-required). Run the REST server with persistent storage so restarts do not erase the WhatsApp session.

At minimum, configure GOWA with:

- `APP_BASIC_AUTH` using a unique username and strong random password.
- Persistent storage for its database and session keys.
- `WHATSAPP_PRESENCE_ON_CONNECT=unavailable` if you want phone notifications preserved.
- `WHATSAPP_AUTO_DOWNLOAD_MEDIA=false` if Nudge only needs text and metadata.

GOWA accepts command-line flags, environment variables, or an `.env` file. Its documented precedence is command line, environment, then `.env`.

## 2. Publish it safely

Put GOWA behind an HTTPS reverse proxy or authenticated Cloudflare Tunnel.

- Bind the GOWA application port to localhost or a private container network.
- Expose only ports 80 and 443 publicly.
- Use a valid public certificate and keep TLS verification enabled.
- Keep Basic Auth enabled even when using an obscure hostname.
- Do not put the Basic Auth username or password in the URL.
- Do not expose logs, backups, databases, or session-key files from the web root.
- Keep GOWA and the host updated.

The Nudge bridge URL must be the HTTPS origin only, for example:

```text
https://chat-bridge.example.com
```

Do not include `/api`, `/app/status`, a username, a password, or a trailing subpath.

## 3. Link WhatsApp

1. Open the authenticated GOWA dashboard.
2. Add a device and scan the QR code from **WhatsApp → Linked devices** on the phone.
3. Wait until GOWA reports the device as connected and logged in.
4. Copy the device ID exactly. It commonly resembles a WhatsApp JID and must match the linked GOWA device.

GOWA v8 and later supports multiple accounts. Nudge sends the selected device ID in the `X-Device-Id` header on every request.

## 4. Connect Nudge

In Nudge, open **Settings → Integrations → WhatsApp bridge** and enter:

| Field | Value |
| --- | --- |
| Bridge URL | The public HTTPS GOWA origin. |
| Username | GOWA Basic Auth username. |
| Password | GOWA Basic Auth password. |
| Device ID | The linked GOWA device ID. |

Choose **Save WhatsApp**, then refresh Nudge. WhatsApp appears in desktop navigation and the mobile plugin tray after all four values are valid.

Nudge encrypts the connection record with `NUDGE_ENCRYPTION_KEY` before storing it in the main D1 database. Saved secret values are never returned to the browser.

### Advanced: Worker-secret fallback

For unattended deployments, the same connection can be supplied as Cloudflare Worker secrets:

```sh
npx wrangler secret put WHATSAPP_BASE_URL
npx wrangler secret put WHATSAPP_USERNAME
npx wrangler secret put WHATSAPP_PASSWORD
npx wrangler secret put WHATSAPP_DEVICE_ID
npm run deploy
```

The in-app Settings flow is preferred because it is easier to replace or remove the bridge without editing deployment configuration. Do not configure both unless you intentionally need the Worker-secret values as fallback.

## What Nudge does

| Action | Behavior |
| --- | --- |
| Open WhatsApp | Fetches chat names and timestamps on demand. |
| Open a chat | Fetches recent messages for that selected chat. |
| Ask the assistant | Lists or reads WhatsApp only after an explicit WhatsApp request. |
| Compose | Creates a visible preview; the assistant cannot send it. |
| Send | Requires a single-use confirmation bound to the exact recipient and text. |
| Delegate | Continues one confirmed one-to-one text conversation for at most 60 minutes and 20 replies. |
| Contacts | Searches GOWA's synced address book, including contacts without chat history. |
| Message search | Filters one explicitly selected chat by text, date, sender, or media. |
| Groups | Lists groups and reads group details or participants without changing membership. |
| Message state | Reacts, marks read, stars, or unstars only after an explicit instruction. |
| Chat state | Archives, unarchives, pins, or unpins only after an explicit instruction. |
| Forward | Requires a single-use confirmation bound to the source message and destination. |

Approvals expire after ten minutes and cannot be replayed. During a voice call, Nudge reads back the exact recipient and message, asks once, and sends immediately when the user explicitly confirms in the next turn. No separate WhatsApp-screen approval is required.

### Delegated conversations

After saving the bridge, use **Settings → Integrations → WhatsApp bridge → Generate secret**. Copy the one-time values into the GOWA webhook configuration and enable `message` and `message.ack` events. GOWA must send the HMAC-SHA256 digest of the raw request body in `X-Hub-Signature-256` (with or without the `sha256=` prefix).

When Cloudflare Access is active, rerun `npm run setup:cloudflare` after updating. Setup creates a narrowly scoped **Bypass** application only for `/webhooks/whatsapp/gowa`; all other Nudge routes remain owner-authenticated. The webhook itself rejects unsigned, replayed, duplicate, group, wrong-device, and unrelated-chat events.

If Access cannot be updated, set `WHATSAPP_WEBHOOK_URL` to `https://<worker>.<subdomain>.workers.dev/webhooks/whatsapp/gowa`. This public route still requires the one-time HMAC secret and does not expose browser APIs.

Nudge stores delegated objectives, conversation events, generated replies, and outcomes encrypted in D1 for the audit view. It does not add them to Memories. It pauses on media, manual takeover, consequential commitments, uncertainty, or Gemini/integration failure. Normal on-demand chats are still fetched live and are not cached or stored.

Nudge intentionally does not expose GOWA's device logout, message deletion/revocation, message editing, group administration, remote media download, or call-control tools. Those operations have a larger destructive or account-security impact than a private assistant needs.

Nudge resolves one-to-one chat labels from GOWA's synced contact directory before falling back to GOWA's stored chat name or phone number. Contact-name search includes synced contacts even when they have no recent conversation, including assistant requests such as “message Mrs Junior.” Rename contacts on the phone and allow GOWA to sync them; Nudge does not maintain a separate address book.

## Troubleshooting

### WhatsApp does not appear

All four values are required. Save them under Settings, refresh Nudge, and confirm the bridge URL is an HTTPS origin without a path.

### Connection needs attention

Open GOWA and confirm `connected` and `logged_in` are true. If the phone removed the linked device or the session expired, scan a new QR code.

### Authentication failed

Confirm the Basic Auth values in Nudge exactly match GOWA. Enter the raw username and password, not strings such as `Authorization: Basic ...`.

### Service unavailable or timeout

Verify the public hostname from a network outside the VPS. Check DNS, the TLS certificate, reverse-proxy routing, the GOWA REST process, and host firewall. Do not disable TLS validation to hide a certificate problem.

### Chats are empty

Confirm the configured device ID belongs to the linked account. If GOWA was newly linked, allow its initial sync to finish and verify chats appear in the GOWA dashboard first.

### Phone numbers appear instead of contact names

Update GOWA to a current release, confirm `/user/my/contacts` returns the saved contact, and allow the linked device to finish contact synchronization. Nudge falls back to a phone number when GOWA has no saved, push, or business name for that JID.

## Provider warning

GOWA uses an unofficial WhatsApp Web connection rather than Meta's official Business API. Provider changes can break the bridge, and automated use may carry account-policy risk. Keep sending human-reviewed, avoid bulk or unsolicited messaging, and use a dedicated account where account continuity is important.
