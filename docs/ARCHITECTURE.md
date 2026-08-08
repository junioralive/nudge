# Architecture

The Worker serves the PWA and Hono API. D1 is the source of truth for tasks, workspaces, settings, push devices, and notification delivery records. Cron claims due delivery sequences atomically. Each active device receives its own delivery and retry state.

Gemini is optional voice and reminder personalization. Second Brain is optional durable memory and semantic recall. Memory failures never block task operations.
