import { afterEach, describe, expect, it, vi } from "vitest";
import { captureMemory, listRecentMemories, recallMemories, SecondBrainError } from "./secondBrain";
import type { Env } from "./types";

const env = {
  SECOND_BRAIN_URL: "https://memory.example.test",
  SECOND_BRAIN_TOKEN: "secret-token",
} as Env;

afterEach(() => vi.unstubAllGlobals());

describe("Second Brain adapter", () => {
  it("tags Nudge captures by workspace without exposing auth in the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, id: "memory-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await captureMemory(env, { content: "Use weekly pricing reviews", workspace: "My Startup", tags: ["pricing"] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://memory.example.test/capture");
    expect(init.headers.Authorization).toBe("Bearer secret-token");
    expect(JSON.parse(init.body)).toEqual({
      content: "Use weekly pricing reviews",
      tags: ["nudge", "workspace-my-startup", "pricing"],
      source: "nudge",
    });
  });

  it("scopes recall and recent listing to a workspace", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true, results: [] }), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    await recallMemories(env, { query: "pricing", workspace: "Work", topK: 50 });
    await listRecentMemories(env, { workspace: "Work", limit: 500 });
    expect(String(fetchMock.mock.calls[0][0])).toContain("topK=20");
    expect(String(fetchMock.mock.calls[0][0])).toContain("tag=workspace-work");
    expect(String(fetchMock.mock.calls[1][0])).toContain("n=100");
  });

  it("turns upstream auth and malformed responses into safe errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "bad token" }), { status: 401 })));
    await expect(recallMemories(env, { query: "x" })).rejects.toMatchObject({ status: 502 });
  });
});
