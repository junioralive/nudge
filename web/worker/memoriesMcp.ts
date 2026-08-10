import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import {
  appendMemory,
  captureMemory,
  forgetMemory,
  getMemory,
  linkMemories,
  listRecentMemories,
  memoryConnections,
  recallMemories,
  setMemoryStatus,
  unlinkMemories,
  updateMemory,
} from "./secondBrain";
import type { Env } from "./types";

type McpEnv = Cloudflare.Env & Env;

const readOnly: ToolAnnotations = { title: "Read Memories", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const write: ToolAnnotations = { title: "Write Memory", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const destructive: ToolAnnotations = { title: "Delete Memory", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

function text(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: typeof value === "object" && value !== null ? value as Record<string, unknown> : { result: value },
  };
}

export class MemoriesMCP extends McpAgent<McpEnv> {
  server = new McpServer({ name: "nudge-memories", version: "1.0.0" });

  async init() {
    const env = (this as unknown as { env: Env }).env;
    this.server.registerTool("remember", {
      description: "Store durable knowledge in Memories. Routine tasks, credentials, raw transcripts, email bodies, and transient chat must not be stored.",
      inputSchema: { content: z.string().min(1).max(20_000), workspace: z.string().optional(), tags: z.array(z.string()).max(20).optional() },
      annotations: { ...write, title: "Remember" },
    }, async (input) => text(await captureMemory(env, input)));

    this.server.registerTool("append", {
      description: "Append a dated update to an existing memory without discarding its current content.",
      inputSchema: { id: z.string().min(1), content: z.string().min(1).max(10_000) },
      annotations: { ...write, title: "Append to Memory" },
    }, async ({ id, content }) => text(await appendMemory(env, id, content)));

    this.server.registerTool("update", {
      description: "Replace an existing memory's content and optionally its user tags.",
      inputSchema: { id: z.string().min(1), content: z.string().min(1).max(20_000), tags: z.array(z.string()).max(20).optional() },
      annotations: { ...write, title: "Update Memory" },
    }, async ({ id, content, tags }) => text(await updateMemory(env, id, content, tags)));

    this.server.registerTool("set_status", {
      description: "Set a memory lifecycle state to canonical, draft, or deprecated.",
      inputSchema: { id: z.string().min(1), status: z.enum(["canonical", "draft", "deprecated"]) },
      annotations: { ...write, title: "Set Memory Status" },
    }, async ({ id, status }) => text(await setMemoryStatus(env, id, status)));

    this.server.registerTool("recall", {
      description: "Semantically and lexically recall relevant memories, optionally within one workspace.",
      inputSchema: { query: z.string().min(1).max(2_000), workspace: z.string().optional(), topK: z.number().int().min(1).max(20).default(5), after: z.number().optional(), before: z.number().optional(), hops: z.number().int().min(0).max(3).optional() },
      annotations: { ...readOnly, title: "Recall Memories" },
    }, async (input) => text(await recallMemories(env, input)));

    this.server.registerTool("list_recent", {
      description: "List recent memories, optionally within one workspace.",
      inputSchema: { workspace: z.string().optional(), limit: z.number().int().min(1).max(100).default(20), after: z.number().optional(), before: z.number().optional() },
      annotations: { ...readOnly, title: "List Recent Memories" },
    }, async (input) => text(await listRecentMemories(env, input)));

    this.server.registerTool("get", {
      description: "Get the full content and metadata of one memory by ID.",
      inputSchema: { id: z.string().min(1) },
      annotations: { ...readOnly, title: "Get Memory" },
    }, async ({ id }) => text(await getMemory(env, id)));

    this.server.registerTool("forget", {
      description: "Permanently delete one memory and its relationships. Confirm user intent before calling.",
      inputSchema: { id: z.string().min(1) },
      annotations: destructive,
    }, async ({ id }) => text(await forgetMemory(env, id)));

    this.server.registerTool("link", {
      description: "Create an explicit typed relationship between two memories.",
      inputSchema: { sourceId: z.string().min(1), targetId: z.string().min(1), type: z.string().default("relates_to") },
      annotations: { ...write, title: "Link Memories" },
    }, async ({ sourceId, targetId, type }) => text(await linkMemories(env, sourceId, targetId, type)));

    this.server.registerTool("unlink", {
      description: "Remove a relationship between two memories.",
      inputSchema: { sourceId: z.string().min(1), targetId: z.string().min(1), type: z.string().optional() },
      annotations: destructive,
    }, async ({ sourceId, targetId, type }) => text(await unlinkMemories(env, sourceId, targetId, type)));

    this.server.registerTool("connections", {
      description: "List memories connected to one memory, including relationship metadata.",
      inputSchema: { id: z.string().min(1), type: z.string().optional() },
      annotations: { ...readOnly, title: "Memory Connections" },
    }, async ({ id, type }) => text(await memoryConnections(env, id, type)));
  }
}

export const memoriesMcpHandler = MemoriesMCP.serve("/memories/mcp");
