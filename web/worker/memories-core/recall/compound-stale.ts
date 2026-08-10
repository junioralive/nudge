import type { RecallMatch, CompoundStaleSignal } from "./types";

export const COMPOUND_STALE_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/** Warn when multiple recalled sources have not been touched in 90+ days. */
export function computeCompoundStale(matches: RecallMatch[], now = Date.now()): CompoundStaleSignal | undefined {
  const aged = matches.filter(m => m.staleAsOf && now - m.updatedAt >= COMPOUND_STALE_AGE_MS);
  if (aged.length < 2) return undefined;
  return {
    count: aged.length,
    oldestUpdatedAt: Math.min(...aged.map(m => m.updatedAt)),
  };
}
