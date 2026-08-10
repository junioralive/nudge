import { captureEntry, buildEntryFilterQuery } from "./memories-core/capture/entry";
import { applyStatus, forgetEntry } from "./memories-core/capture/lifecycle";
import { appendToEntry, updateEntryContent } from "./memories-core/capture/store";
import { initializeDatabase } from "./memories-core/db/init";
import { createEdge, deleteEdge } from "./memories-core/graph/edges";
import { buildGraph, getConnections } from "./memories-core/graph/traverse";
import { type MemoryStatus } from "./memories-core/memory/status";
import { recallEntries } from "./memories-core/recall/search";
import { checkVectorizeHealth } from "./memories-core/vectorize/health";
import { importExportPayload } from "./memories-core/entries/import";
import { estimate, readMigration, runBatch } from "./memories-core/migration/embedding";
import { DEFAULTS, readOverrides, resolveConfig, writeOverrides, type Config } from "./memories-core/config";
import type { Env } from "./types";

export class SecondBrainError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

type MemoryEnv = Env & {
  MEMORY_DB: D1Database;
  MEMORY_VECTORIZE: VectorizeIndex;
  MEMORY_CONFIG_KV: KVNamespace;
  AI: { run(model: string, input: unknown): Promise<unknown> };
};

export function memoriesConfigured(env: Env): env is MemoryEnv {
  return Boolean(env.MEMORY_DB && env.MEMORY_VECTORIZE && env.MEMORY_CONFIG_KV && env.AI);
}

function memoryEnv(env: Env): MemoryEnv {
  if (!memoriesConfigured(env)) throw new SecondBrainError("Memories is not configured", 503);
  return env;
}

async function ready(env: Env): Promise<MemoryEnv> {
  const configured = memoryEnv(env);
  await initializeDatabase(configured as any);
  return configured;
}

function detachedContext(): ExecutionContext {
  return {
    waitUntil(promise) { void promise.catch((error) => console.error("memory_background_failed", { error: error instanceof Error ? error.name : "error" })); },
    passThroughOnException() {},
    props: {},
  } as ExecutionContext;
}

export function workspaceTag(workspace?: string | null): string | undefined {
  if (!workspace || workspace.toLowerCase() === "all") return undefined;
  const slug = workspace.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug ? `workspace-${slug}` : undefined;
}

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((tag): tag is string => typeof tag === "string");
  if (typeof value !== "string") return [];
  try { return parseTags(JSON.parse(value)); } catch { return []; }
}

function publicEntry(row: Record<string, any>) {
  const tags = parseTags(row.tags);
  return {
    id: String(row.id),
    content: String(row.content ?? ""),
    tags,
    source: String(row.source ?? "nudge"),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at ?? row.created_at),
    recall_count: Number(row.recall_count ?? 0),
    importance_score: Number(row.importance_score ?? 0),
    status: tags.find((tag) => tag.startsWith("status:"))?.slice(7) || "canonical",
  };
}

export async function captureMemory(env: Env, input: { content: string; workspace?: string | null; tags?: string[] }, ctx?: ExecutionContext): Promise<any> {
  const configured = await ready(env);
  const tag = workspaceTag(input.workspace);
  const tags = Array.from(new Set(["nudge", ...(tag ? [tag] : []), ...(input.tags || [])])).slice(0, 20);
  const result = await captureEntry(input.content, tags, "nudge", configured as any, ctx || detachedContext());
  return { ok: true, ...result, workspace: input.workspace || "All" };
}

export async function recallMemories(env: Env, input: { query: string; workspace?: string | null; topK?: number; after?: number; before?: number; hops?: number }): Promise<any> {
  const configured = await ready(env);
  const result = await recallEntries({
    query: input.query,
    topK: Math.max(1, Math.min(20, Number(input.topK) || 5)),
    tag: workspaceTag(input.workspace),
    after: input.after,
    before: input.before,
    hops: input.hops,
    synthesize: false,
  }, configured as any, detachedContext());
  return {
    ok: true,
    query_used: result.queryUsed,
    compound_stale: result.compoundStale,
    results: result.matches.map((match) => ({
      id: match.id,
      content: match.content,
      score: Math.round(match.score * 1000) / 10,
      tags: match.tags,
      source: match.source,
      created_at: match.createdAt,
      updated_at: match.updatedAt,
      stale_as_of: match.staleAsOf,
      is_update: match.isUpdate,
      hop: match.hop,
      via_type: match.viaType,
      via_from: match.viaFrom,
    })),
    insight: result.insight,
    semantic_unavailable: result.semanticUnavailable,
  };
}

export async function listRecentMemories(env: Env, input: { workspace?: string | null; limit?: number; after?: number; before?: number }): Promise<any> {
  const configured = await ready(env);
  const query = buildEntryFilterQuery({
    n: Math.max(1, Math.min(100, Number(input.limit) || 20)),
    tag: workspaceTag(input.workspace),
    after: input.after,
    before: input.before,
  });
  const rows = await configured.MEMORY_DB.prepare(query.sql).bind(...query.bindings).all<Record<string, any>>();
  const entries = (rows.results || []).map(publicEntry);
  return { ok: true, entries, results: entries };
}

export async function getMemory(env: Env, id: string): Promise<any> {
  const configured = await ready(env);
  const row = await configured.MEMORY_DB.prepare(`SELECT * FROM entries WHERE id = ?`).bind(id).first<Record<string, any>>();
  if (!row) throw new SecondBrainError("Memory not found", 404);
  return { ok: true, entry: publicEntry(row) };
}

export async function updateMemory(env: Env, id: string, content: string, tags?: string[]): Promise<any> {
  const configured = await ready(env);
  const result = await updateEntryContent(configured as any, id, content, await resolveConfig(configured as any), undefined, tags);
  if (result.status === "not_found") throw new SecondBrainError("Memory not found", 404);
  if (result.status === "reembed_failed") throw new SecondBrainError("Memory indexing failed; original was kept", 503);
  return { ok: true, status: result.status, semantic_unavailable: result.vectorIds === null };
}

export async function appendMemory(env: Env, id: string, addition: string): Promise<any> {
  const configured = await ready(env);
  const row = await configured.MEMORY_DB.prepare(`SELECT content, tags, source FROM entries WHERE id = ?`).bind(id).first<Record<string, any>>();
  if (!row) throw new SecondBrainError("Memory not found", 404);
  const indexed = await appendToEntry(configured as any, id, String(row.content), addition, parseTags(row.tags), String(row.source), await resolveConfig(configured as any));
  return { ok: true, status: "appended", semantic_unavailable: !indexed };
}

export async function setMemoryStatus(env: Env, id: string, status: MemoryStatus): Promise<any> {
  const configured = await ready(env);
  if (!await applyStatus(id, status, configured as any)) throw new SecondBrainError("Memory not found", 404);
  return { ok: true, status };
}

export async function forgetMemory(env: Env, id: string): Promise<any> {
  const result = await forgetEntry(id, await ready(env) as any);
  if (result.status === "not_found") throw new SecondBrainError("Memory not found", 404);
  return { ok: true, ...result };
}

export async function memoryGraph(env: Env, seed?: string, limit = 250): Promise<any> {
  const configured = await ready(env);
  return { ok: true, ...(await buildGraph({ seed, limit }, configured as any, await resolveConfig(configured as any))) };
}

export async function memoryConnections(env: Env, id: string, type?: string): Promise<any> {
  return { ok: true, connections: await getConnections(id, type, await ready(env) as any) };
}

export async function linkMemories(env: Env, sourceId: string, targetId: string, type = "relates_to"): Promise<any> {
  const result = await createEdge(sourceId, targetId, type, { provenance: "explicit", weight: 1 }, await ready(env) as any);
  if (!result) throw new SecondBrainError("Invalid memory relationship", 400);
  return { ok: true, edge: result };
}

export async function unlinkMemories(env: Env, sourceId: string, targetId: string, type?: string): Promise<any> {
  return { ok: true, removed: await deleteEdge(sourceId, targetId, type, await ready(env) as any) };
}

export async function memoryStats(env: Env): Promise<any> {
  const configured = await ready(env);
  const counts = await configured.MEMORY_DB.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN tags LIKE '%\"status:deprecated\"%' THEN 1 ELSE 0 END) AS deprecated, SUM(CASE WHEN vector_ids = '[]' AND tags NOT LIKE '%\"status:deprecated\"%' THEN 1 ELSE 0 END) AS pending_index, SUM(recall_count) AS recalls FROM entries`).first<Record<string, any>>();
  const edges = await configured.MEMORY_DB.prepare(`SELECT COUNT(*) AS total FROM edges`).first<{ total: number }>();
  return { ok: true, total: Number(counts?.total || 0), deprecated: Number(counts?.deprecated || 0), pendingIndex: Number(counts?.pending_index || 0), recalls: Number(counts?.recalls || 0), edges: Number(edges?.total || 0) };
}

export async function memoriesHealth(env: Env): Promise<any> {
  if (!memoriesConfigured(env)) return { configured: false, healthy: false, database: false, vectorize: false, workersAi: false };
  try {
    const configured = await ready(env);
    const vector = await checkVectorizeHealth(configured as any);
    const stats = await memoryStats(configured);
    return { configured: true, healthy: true, database: true, vectorize: vector, workersAi: true, pendingIndex: stats.pendingIndex };
  } catch (error) {
    return { configured: true, healthy: false, error: error instanceof Error ? error.message : "Memories unavailable" };
  }
}

export async function memoryConfig(env: Env): Promise<any> {
  const configured = await ready(env);
  return { ok: true, effective: await resolveConfig(configured as any), overrides: await readOverrides(configured as any), defaults: DEFAULTS };
}

export async function updateMemoryConfig(env: Env, patch: Partial<Config>): Promise<any> {
  const result = await writeOverrides(await ready(env) as any, patch);
  if (!result.ok) throw new SecondBrainError(result.error, 400);
  return memoryConfig(env);
}

export async function askMemories(env: Env, question: string, workspace?: string | null): Promise<any> {
  const configured = await ready(env);
  const recalled = await recallMemories(configured, { query: question, workspace, topK: 8, hops: 1 });
  const sources = recalled.results.slice(0, 8);
  if (!sources.length) return { ok: true, answer: "I could not find a memory that answers that.", sources: [] };
  const evidence = sources.map((entry: any, index: number) => `[${index + 1}] ${entry.content}`).join("\n\n");
  const output: any = await configured.AI.run(DEFAULTS.LLM_MODEL, {
    messages: [
      { role: "system", content: "Answer only from the supplied memories. Cite every factual claim with [n]. If the memories do not support an answer, say so. Never invent details." },
      { role: "user", content: `Question: ${question}\n\nMemories:\n${evidence}` },
    ],
    max_tokens: 700,
  });
  const answer = String(output?.response ?? output?.result?.response ?? "I could not generate a grounded answer.");
  return { ok: true, answer, sources: sources.map((entry: any) => ({ id: entry.id, content: entry.content, tags: entry.tags })) };
}

export async function exportMemories(env: Env): Promise<any> {
  const configured = await ready(env);
  const entries = await configured.MEMORY_DB.prepare(`SELECT * FROM entries ORDER BY created_at`).all<Record<string, any>>();
  const edges = await configured.MEMORY_DB.prepare(`SELECT * FROM edges ORDER BY created_at`).all<Record<string, any>>();
  return { version: 1, exportedAt: new Date().toISOString(), entries: entries.results || [], edges: edges.results || [] };
}

export async function importMemories(
  env: Env,
  payload: Record<string, unknown>,
  options: { offset?: number; edgeOffset?: number; limit?: number } = {},
): Promise<any> {
  const configured = await ready(env);
  if (!Array.isArray(payload.entries)) throw new SecondBrainError("A Memories export with an entries array is required", 400);
  const result = await importExportPayload(configured as any, payload as any, {
    offset: Math.max(0, Number(options.offset) || 0),
    edgeOffset: Math.max(0, Number(options.edgeOffset) || 0),
    limit: Math.max(1, Math.min(100, Number(options.limit) || 50)),
  });
  return result;
}

export async function memoryReindexStatus(env: Env): Promise<any> {
  const configured = await ready(env);
  const [projection, migration] = await Promise.all([
    estimate(configured as any),
    readMigration(configured as any),
  ]);
  return { ok: true, estimate: projection, migration };
}

export async function reindexMemories(env: Env): Promise<any> {
  const configured = await ready(env);
  const result = await runBatch(configured as any, await resolveConfig(configured as any));
  return { ok: true, ...result };
}
