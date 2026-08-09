# Email assistant

Email is an optional, on-demand capability backed by a separately deployed [Email MCP Server](https://github.com/junioralive/email-mcp-for-cloudflare-workers). Nudge does not store mailbox credentials and does not poll inboxes in the background.

## Privacy behavior

- Opening Email loads message headers only: account, sender, subject, date, and flags.
- Message bodies are fetched only after you open a message or explicitly ask the voice assistant to read it.
- HTML is converted to plain text; remote images and attachment bytes are not returned.
- Email content is not copied into D1 or Second Brain. Creating a task stores only the reviewed task text and an opaque message reference.
- Gemini receives email data only during an explicit email request. It cannot send, archive, or change read state.

## Cloudflare Access service identity

Create a dedicated service token under Zero Trust → Access controls → Service credentials → Service Tokens. Name it `Nudge Email` and add it to the Email MCP Access application with a `Service Auth` policy.

The hardened Email MCP integration recognizes that service-token Client ID and permits only:

- account listing and inbox counts;
- header-only inbox listing and search;
- explicitly selected message and thread reads;
- signed read/unread, archive, draft, and send operations.

Account management, attachments, arbitrary moves, trash, and permanent deletion remain unavailable to Nudge.

Set the Nudge Worker configuration:

```text
EMAIL_MCP_URL=https://email.example.com
EMAIL_ACCESS_CLIENT_ID=<secret>
EMAIL_ACCESS_CLIENT_SECRET=<secret>
EMAIL_ACTION_SIGNING_SECRET=<secret>
```

Set the matching Email MCP Worker secrets:

```text
NUDGE_ACCESS_CLIENT_ID=<same service-token Client ID>
NUDGE_ACTION_SIGNING_SECRET=<same action-signing secret>
```

`npm run setup:cloudflare` can install these values after the service token exists.

## Sending safety

Voice can prepare a proposal but cannot create or send a mailbox draft. The proposal opens in Nudge for review. Saving creates an IMAP draft and returns a one-use, ten-minute send approval. Sending requires a separate visible button press and a same-origin authenticated request.

Read/unread and archive approvals are also short-lived, signed, action-specific, and single-use.

## Multiple accounts

The Email page defaults to a unified inbox and supports filtering by account. Partial failures do not hide messages from healthy accounts. Account credentials and OAuth refresh tokens remain encrypted inside the Email MCP deployment.
