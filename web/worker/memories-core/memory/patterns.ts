// The pattern review queue, in one predicate.
//
// The nightly pass proposes patterns it noticed across several memories, and
// they are excluded from recall until a human confirms them. Dismissing one
// deprecates it rather than deleting it — the audit row stays, tags and all —
// so an entry carries `auto-pattern` forever whether or not it was ever ruled
// on. The tag alone is a history, not a queue.
//
// Reading it as a queue is what broke the dashboard's own pattern panel: it
// asked for the newest twenty auto-pattern rows and dropped the deprecated ones
// in the browser, so on a brain with more than a page of dismissals it threw
// away every row it fetched and rendered empty while real patterns waited
// behind them. Whoever asks "what still needs a decision?" needs both halves,
// which is why they live here together.

/** Proposed by the nightly pass, and not yet ruled on. */
export const PENDING_PATTERN_SQL = `tags LIKE '%"auto-pattern"%' AND tags NOT LIKE '%"status:deprecated"%'`;
