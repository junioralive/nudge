import { describe, expect, it } from "vitest";
import { memoriesConfigured, recallMemories, workspaceTag } from "./secondBrain";
import type { Env } from "./types";

describe("embedded Memories adapter", () => {
  it("creates stable workspace tags", () => {
    expect(workspaceTag("My Startup")).toBe("workspace-my-startup");
    expect(workspaceTag("All")).toBeUndefined();
    expect(workspaceTag("  Product & Growth  ")).toBe("workspace-product-growth");
  });

  it("requires every embedded storage and AI binding", () => {
    const complete = { MEMORY_DB: {}, MEMORY_VECTORIZE: {}, MEMORY_CONFIG_KV: {}, AI: {} } as Env;
    expect(memoriesConfigured(complete)).toBe(true);
    expect(memoriesConfigured({ ...complete, AI: undefined })).toBe(false);
    expect(memoriesConfigured({ ...complete, MEMORY_VECTORIZE: undefined })).toBe(false);
  });

  it("fails safely instead of falling back to the external service", async () => {
    await expect(recallMemories({} as Env, { query: "x" }))
      .rejects.toMatchObject({ status: 503, message: "Memories is not configured" });
  });
});
