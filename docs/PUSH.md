# Push notifications

Nudge sends one due-time reminder by default and optional per-task follow-ups. The service worker uses the Nudge icon, a stable task tag, safe task-title content, and vibration where supported. Background notification sound is controlled by the operating system; the bundled MP3 is used for foreground/test cues.

If a device expires, Nudge removes it. Use Notifications → Send test to verify a device before relying on scheduled reminders.
