import type { Env } from "./types";

export class SecondBrainError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

function workspaceTag(workspace?: string | null): string | undefined {
  if (!workspace || workspace.toLowerCase() === "all") return undefined;
  const slug = workspace
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug ? `workspace-${slug}` : undefined;
}

function endpoint(env: Env, path: string): URL {
  if (!env.SECOND_BRAIN_URL || !env.SECOND_BRAIN_TOKEN) throw new SecondBrainError("Second Brain is not configured", 503);
  return new URL(path, `${env.SECOND_BRAIN_URL.replace(/\/$/, "")}/`);
}

async function requestJson(env: Env, path: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(endpoint(env, path), {
    ...init,
    headers: {
      Authorization: `Bearer ${env.SECOND_BRAIN_TOKEN}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(8_000),
  });

  const body: any = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body.error === "string" ? body.error : `Second Brain returned ${response.status}`;
    throw new SecondBrainError(message, response.status === 401 ? 502 : response.status);
  }
  if (body === null) throw new SecondBrainError("Second Brain returned invalid JSON");
  return body;
}

export async function captureMemory(
  env: Env,
  input: { content: string; workspace?: string | null; tags?: string[] },
): Promise<any> {
  const tag = workspaceTag(input.workspace);
  const tags = Array.from(new Set(["nudge", ...(tag ? [tag] : []), ...(input.tags || [])])).slice(0, 20);
  return requestJson(env, "/capture", {
    method: "POST",
    body: JSON.stringify({ content: input.content, tags, source: "nudge" }),
  });
}

export async function recallMemories(
  env: Env,
  input: { query: string; workspace?: string | null; topK?: number },
): Promise<any> {
  const params = new URLSearchParams({
    query: input.query,
    topK: String(Math.max(1, Math.min(20, Number(input.topK) || 5))),
  });
  const tag = workspaceTag(input.workspace);
  if (tag) params.set("tag", tag);
  return requestJson(env, `/recall?${params}`);
}

export async function listRecentMemories(
  env: Env,
  input: { workspace?: string | null; limit?: number },
): Promise<any> {
  const params = new URLSearchParams({ n: String(Math.max(1, Math.min(100, Number(input.limit) || 20))) });
  const tag = workspaceTag(input.workspace);
  if (tag) params.set("tag", tag);
  return requestJson(env, `/list?${params}`);
}

export async function forgetMemory(env: Env, id: string): Promise<any> {
  return requestJson(env, "/forget", { method: "POST", body: JSON.stringify({ id }) });
}
