import { describe, expect, it } from "vitest";
import { createSession, secureEqual, verifySession } from "./auth";

describe("authentication primitives", () => {
  it("compares app keys without exposing length differences", async () => {
    await expect(secureEqual("correct-key", "correct-key")).resolves.toBe(true);
    await expect(secureEqual("wrong", "correct-key")).resolves.toBe(false);
  });

  it("signs and verifies a session", async () => {
    const session = await createSession("session-secret");
    await expect(verifySession(session, "session-secret")).resolves.toBe(true);
    await expect(verifySession(session, "different-secret")).resolves.toBe(false);
    await expect(verifySession(`${session}x`, "session-secret")).resolves.toBe(false);
  });
});
