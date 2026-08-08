import { describe, expect, it } from "vitest";
import { isPermanentPushFailure } from "./push";
import { retryDelaySeconds } from "./reminders";

describe("push failure handling", () => {
  it("retires expired subscriptions", () => {
    expect(isPermanentPushFailure(404)).toBe(true);
    expect(isPermanentPushFailure(410)).toBe(true);
    expect(isPermanentPushFailure(429)).toBe(false);
    expect(isPermanentPushFailure(503)).toBe(false);
  });

  it("uses bounded exponential retry delays", () => {
    expect(retryDelaySeconds(1)).toBe(60);
    expect(retryDelaySeconds(2)).toBe(120);
    expect(retryDelaySeconds(7)).toBe(3600);
    expect(retryDelaySeconds(20)).toBe(3600);
  });
});
