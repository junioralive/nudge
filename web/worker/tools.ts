import { Type, type FunctionDeclaration } from "@google/genai";
import { addTask, completeTask, deleteTask, isTodayInTimezone, listTasks, publicTask, updateTask } from "./data";
import { captureMemory, listRecentMemories, recallMemories } from "./secondBrain";
import type { Env, TaskRow } from "./types";

export const toolDeclarations: FunctionDeclaration[] = [
  {
    name: "list_tasks",
    description:
      "List the user's exact task state. By default return open tasks for today, overdue, or all. Use filter completed only when the user explicitly asks about finished work or task history. Completed tasks are not memories.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        filter: { type: Type.STRING, enum: ["today", "overdue", "all", "completed"] },
        workspace: { type: Type.STRING, description: "Optional workspace. Omit for all workspaces." },
        query: { type: Type.STRING, description: "Optional text to search in task titles/details." },
        completed_after: { type: Type.STRING, description: "For completed history only: ISO 8601 lower bound for done_at, with timezone offset." },
        completed_before: { type: Type.STRING, description: "For completed history only: ISO 8601 upper bound for done_at, with timezone offset." },
      },
      required: ["filter"],
    },
  },
  {
    name: "add_task",
    description: "Create a task or scheduled nudge. Do not also save routine task state as a memory.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        text: { type: Type.STRING },
        title: { type: Type.STRING, description: "Short task title, maximum 200 characters." },
        details: { type: Type.STRING, description: "Preserve the user's complete explanation, constraints, and context. Do not summarize away meaningful details." },
        due_at: { type: Type.STRING, description: "ISO 8601 datetime with timezone offset." },
        workspace: { type: Type.STRING },
      },
      required: ["text"],
    },
  },
  {
    name: "update_task",
    description: "Update an existing task after finding its ID with list_tasks.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.NUMBER },
        text: { type: Type.STRING },
        title: { type: Type.STRING },
        details: { type: Type.STRING },
        due_at: { type: Type.STRING },
        workspace: { type: Type.STRING },
      },
      required: ["id"],
    },
  },
  {
    name: "complete_task",
    description: "Mark a task done after finding its ID with list_tasks.",
    parameters: { type: Type.OBJECT, properties: { id: { type: Type.NUMBER } }, required: ["id"] },
  },
  {
    name: "delete_task",
    description: "Permanently delete a task after finding its ID and confirming user intent.",
    parameters: { type: Type.OBJECT, properties: { id: { type: Type.NUMBER } }, required: ["id"] },
  },
  {
    name: "remember_memory",
    description:
      "Store durable personal context. Use for explicit remember requests and clear preferences, decisions, relationships, or project facts. Never store credentials, raw transcripts, routine task state, assistant output, or transient chat. Confirm what was saved after success.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        content: { type: Type.STRING },
        workspace: { type: Type.STRING },
        tags: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ["content"],
    },
  },
  {
    name: "recall_memory",
    description:
      "Search personal memory when an answer depends on preferences, people, history, or past decisions. Do not use for simple task operations.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING },
        workspace: { type: Type.STRING },
        topK: { type: Type.NUMBER },
      },
      required: ["query"],
    },
  },
  {
    name: "list_recent_memories",
    description: "Browse recent memories, optionally within one workspace.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        workspace: { type: Type.STRING },
        limit: { type: Type.NUMBER },
      },
    },
  },
];

function compactTask(task: TaskRow) {
  return {
    id: task.id,
    text: task.text,
    details: task.details,
    due_at: task.due_at,
    workspace: task.workspace,
    done_at: task.done_at,
  };
}

function inCompletionRange(value: string, after?: unknown, before?: unknown): boolean {
  const completedAt = new Date(value).getTime();
  if (Number.isNaN(completedAt)) return false;
  if (after !== undefined && after !== null && after !== "") {
    const lower = new Date(String(after)).getTime();
    if (Number.isNaN(lower)) throw new Error("completed_after must be a valid ISO 8601 datetime");
    if (completedAt < lower) return false;
  }
  if (before !== undefined && before !== null && before !== "") {
    const upper = new Date(String(before)).getTime();
    if (Number.isNaN(upper)) throw new Error("completed_before must be a valid ISO 8601 datetime");
    if (completedAt > upper) return false;
  }
  return true;
}

function normalizeToolDue(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error("due_at must be an ISO 8601 datetime with timezone");
  return date.toISOString();
}

export async function runTool(env: Env, name: string, args: Record<string, any>): Promise<any> {
  if (name === "list_tasks") {
    const completed = args.filter === "completed";
    let rows = (await listTasks(env)).filter((task) => completed ? Boolean(task.done_at) : !task.done_at);
    if (args.workspace) {
      rows = rows.filter((task) => task.workspace.toLowerCase() === String(args.workspace).toLowerCase());
    }

    if (args.query) {
      const query = String(args.query).trim().toLowerCase();
      rows = rows.filter((task) => `${task.text}\n${task.details || ""}`.toLowerCase().includes(query));
    }

    const timezone = env.APP_TIMEZONE || "Asia/Kolkata";
    if (completed) {
      rows = rows.filter((task) => inCompletionRange(task.done_at!, args.completed_after, args.completed_before));
      rows.sort((a, b) => (b.done_at || "").localeCompare(a.done_at || ""));
    } else if (args.filter === "today") {
      rows = rows.filter((task) => task.due_at && isTodayInTimezone(task.due_at, timezone));
    } else if (args.filter === "overdue") {
      rows = rows.filter((task) => task.due_at && new Date(task.due_at).getTime() < Date.now());
    }
    return { tasks: rows.map(compactTask), count: rows.length };
  }

  if (name === "add_task") {
    const title = (args.title || args.text || "").trim();
    if (!title) return { ok: false, error: "text is required" };
    const task = await addTask(env, {
      text: title,
      details: String(args.details || ""),
      due_at: normalizeToolDue(args.due_at) || null,
      workspace: args.workspace || "Personal",
    });
    return { ok: true, task: compactTask(task) };
  }

  if (name === "update_task") {
    const task = await updateTask(env, Number(args.id), {
      ...args,
      ...(args.title !== undefined ? { text: args.title } : {}),
      ...(args.due_at !== undefined ? { due_at: normalizeToolDue(args.due_at) } : {}),
    });
    return task ? { ok: true, task: compactTask(task) } : { ok: false, error: "task not found" };
  }

  if (name === "complete_task") {
    return { ok: Boolean(await completeTask(env, Number(args.id))) };
  }

  if (name === "delete_task") {
    return { ok: await deleteTask(env, Number(args.id)) };
  }

  if (name === "remember_memory") {
    if (!args.content?.trim()) return { ok: false, error: "content is required" };
    const result = await captureMemory(env, {
      content: args.content.trim(),
      workspace: args.workspace,
      tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
    });
    return { ok: true, ...result, remembered: args.content.trim().slice(0, 180) };
  }

  if (name === "recall_memory") {
    if (!args.query?.trim()) return { ok: false, error: "query is required" };
    return recallMemories(env, {
      query: args.query.trim(),
      workspace: args.workspace,
      topK: Math.min(Number(args.topK) || 5, 10),
    });
  }

  if (name === "list_recent_memories") {
    return listRecentMemories(env, { workspace: args.workspace, limit: Math.min(Number(args.limit) || 10, 20) });
  }

  return { ok: false, error: `unknown tool ${name}` };
}
