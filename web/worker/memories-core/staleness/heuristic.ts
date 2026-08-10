import type { Volatility } from "../memory/volatility";

const DURABLE_PATTERNS: RegExp[] = [
  /\bbirthday\b/i,
  /\bborn\b/i,
  /\bbirth\s*date\b/i,
  /\bdate of birth\b/i,
  /\bgrew up in\b/i,
  /\bname is\b/i,
  /\bis called\b/i,
  /\bnationality\b/i,
  /\bmaiden name\b/i,
];

const STATE_PATTERNS: RegExp[] = [
  /\bworks?\s+at\b/i,
  /\bwork(s|ing)?\s+for\b/i,
  /\bemployed\b/i,
  /\bjob\s+(at|with)\b/i,
  /\blives?\s+in\b/i,
  /\bplan(s|ning)?\s+to\b/i,
  /\brole\s+at\b/i,
  /\bposition\s+at\b/i,
];

const VOLATILE_PATTERNS: RegExp[] = [
  /\bmeeting\b/i,
  /\bappointment\b/i,
  /\bdeadline\b/i,
];

/**
 * Cheap state-vs-fact classifier. Returns null when uncertain — caller should
 * leave volatility unset and rely on ranking proxies until a clearer signal.
 */
export function classifyVolatility(content: string, tags: string[] = []): Volatility | null {
  if (tags.includes("task")) return "volatile";

  let durableHits = 0;
  let stateHits = 0;
  let volatileHits = 0;

  for (const p of DURABLE_PATTERNS) {
    if (p.test(content)) durableHits++;
  }
  for (const p of STATE_PATTERNS) {
    if (p.test(content)) stateHits++;
  }
  for (const p of VOLATILE_PATTERNS) {
    if (p.test(content)) volatileHits++;
  }

  if (volatileHits > 0 && durableHits === 0) return "volatile";
  if (durableHits > 0 && stateHits === 0 && volatileHits === 0) return "durable";
  if (stateHits > 0) return "state";

  return null;
}

export function shouldFlagStale(volatility: Volatility | null): boolean {
  return volatility === "state" || volatility === "volatile";
}
