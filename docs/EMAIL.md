# Embedded email

Email is an optional module inside the Nudge Worker. It shares one encrypted mailbox store and mail service between the responsive `/email` UI, Nudge voice tools, and the remote MCP endpoint:

```text
https://<your-nudge-host>/email/mcp
```

The Email MCP tool names, schemas, annotations, and result formats remain compatible with the standalone Email MCP server. Existing ChatGPT and Claude connections must reconnect once to the new URL.

## Authentication

The Nudge hostname is protected by one Cloudflare Access self-hosted application covering `/*`. The same application provides the owner-email Allow policy, email OTP, and Managed OAuth for `/email/mcp`. The setup wizard configures 24-hour Access sessions, 15-minute MCP access tokens, 24-hour OAuth grant sessions, dynamic client registration, and disabled localhost/loopback redirects.

In ChatGPT or Claude, add `https://<your-nudge-host>/email/mcp` as a remote MCP server and complete the Cloudflare email OTP flow. Do not use the retired standalone endpoint after migration acceptance passes.

## Configuration

The setup wizard provisions or reuses:

- `EMAIL_KV`: encrypted mailbox accounts and OAuth refresh tokens.
- `CREDENTIAL_ENCRYPTION_KEY`: a base64 32-byte AES-GCM key. Existing deployments must reuse their current value; it must never be rotated automatically.
- `MCP_OBJECT`: the Durable Object that owns Streamable HTTP MCP sessions.
- `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`, and `OUTLOOK_TENANT`: optional Microsoft Entra OAuth configuration.
- `NUDGE_ACTION_SIGNING_SECRET`: short-lived, one-use UI approval tokens.

The Microsoft Entra redirect URI is:

```text
https://<your-nudge-host>/api/email/oauth/outlook/callback
```

Keep the old redirect URI registered during the migration window, then remove it after the old Worker is retired.

## Privacy and safety

- Inbox and search load headers only. Bodies are fetched only when a user opens a message or explicitly asks the voice assistant to read it.
- HTML is converted to plain text; remote images and attachment bytes are not returned to the model.
- Mailbox credentials, OAuth tokens, message bodies, and drafts stay in encrypted KV. They are never written to D1, browser storage, logs, Gemini context outside an explicit email request, or Second Brain.
- Nudge voice uses an allowlist of safe email actions. Sending, archiving, and read-state changes require a visible, short-lived, action-specific approval.
- Direct MCP clients retain the full standalone Email MCP tool set and safety annotations; Cloudflare Access remains the authentication boundary.

## Migration from standalone Email MCP

1. Run `npm run setup:cloudflare` and provide the existing Email KV namespace ID and encryption key.
2. Add the new Microsoft redirect URI while retaining the old one.
3. Deploy the combined Worker and verify account listing, inbox headers, one explicit message read, and one reviewed send from both Nudge and an MCP client.
4. Reconnect ChatGPT and Claude to `/email/mcp`.
5. Keep the old Worker for rollback until production acceptance is complete, then revoke its Access application and retire it.

## Account management

Nudge exposes authenticated account routes for connecting Outlook through OAuth, adding custom IMAP/SMTP credentials, testing, reconnecting, editing, and removing accounts. Credentials are accepted only over same-origin HTTPS requests and are encrypted before KV storage.
