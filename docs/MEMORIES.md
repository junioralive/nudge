# Embedded Memories

Memories is Nudge's built-in durable knowledge system. It is based on the core engine from Second Brain Cloudflare and uses separate Cloudflare resources from operational task data.

## Data ownership

- `DB` contains exact Nudge task, workspace, settings, and reminder state.
- `MEMORY_DB` contains memory entries, lifecycle metadata, and relationship edges.
- `MEMORY_VECTORIZE` contains 384-dimensional semantic vectors.
- `MEMORY_CONFIG_KV` contains sparse, non-secret engine tuning.
- `AI` runs the Workers AI embedding and memory-reasoning models.

Tasks, completed-task history, email bodies, credentials, raw voice transcripts, transient chat, and assistant responses are not automatically saved. Email enters Memories only when the owner explicitly requests a durable fact to be remembered.

## Models and maintenance

- Embeddings: `@cf/baai/bge-small-en-v1.5`
- Reasoning: `@cf/meta/llama-4-scout-17b-16e-instruct`
- Reminder cron: every minute, unchanged.
- Memory maintenance: nightly at `0 1 * * *` UTC for compression, relationship inference, and staleness checks.

Gemini is not used by the Memories engine. It remains optional and powers only the live voice assistant.

## MCP

The remote Streamable HTTP endpoint is `https://<your-nudge-host>/memories/mcp`.

Use the owner-only Nudge Cloudflare Access application covering `/*`. Enable Managed OAuth, use a 15-minute access token and 24-hour grant, and configure its AUD as `NUDGE_ACCESS_AUD`.

Tools: `remember`, `append`, `update`, `set_status`, `recall`, `list_recent`, `get`, `forget`, `link`, `unlink`, and `connections`.

## Backup and restore

Settings & backup can export entries and graph edges as JSON. Imports are idempotent and paged, and semantic reindexing runs in bounded batches. Vector values are intentionally excluded; rebuild them from the source entries after a restore. Keep the Memory D1 export and the Nudge D1 backup together, but do not merge the databases.

Managed OAuth redirect URIs are client callback metadata, not Nudge URLs. During setup, copy the exact HTTPS callback URI shown by each ChatGPT or Claude connector. Cloudflare rejects dynamic registration when the submitted URI is not on the Access application's allowlist.

## Cost and resilience

Memories uses Workers AI, D1, KV, and Vectorize quotas. Keyword recall remains available if Vectorize is temporarily unavailable. Memory failures do not block task creation, reminders, email, or push delivery.
