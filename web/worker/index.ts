import { GoogleGenAI, Modality } from "@google/genai";
import { Hono } from "hono";
import {
  authenticate,
  clearSessionCookie,
  clientAddress,
  createSession,
  requestOriginIsValid,
  requireSecrets,
  secureEqual,
  setSessionCookie,
} from "./auth";
import { addTask, completeTask, deleteTask, getTask, listTasks, updateTask } from "./data";
import { processDueReminders, retryFailedDeliveries } from "./reminders";
import { captureMemory, forgetMemory, listRecentMemories, recallMemories, SecondBrainError } from "./secondBrain";
import { disableDevice, getActiveDevice, getPushStatus, registerSubscription, sendTestPush } from "./push";
import { runTool, toolDeclarations } from "./tools";
import type { AppBindings, Env } from "./types";

const app = new Hono<AppBindings>();
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

app.use("/api/*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
});

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeDueAt(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("due_at must be an ISO 8601 datetime");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("due_at must be an ISO 8601 datetime");
  return date.toISOString();
}

async function jsonBody<T>(c: { req: { json<U>(): Promise<U> } }): Promise<T> {
  return c.req.json<T>().catch(() => ({} as T));
}

app.post("/api/auth/login", async (c) => {
  const origin = c.req.header("Origin");
  if (origin && !requestOriginIsValid(c.req.raw)) return c.json({ error: "forbidden" }, 403);

  const address = clientAddress(c);
  if (c.env.LOGIN_RATE_LIMITER) {
    const limit = await c.env.LOGIN_RATE_LIMITER.limit({ key: address });
    if (!limit.success) return c.json({ error: "too many attempts" }, 429);
  }

  const body = await jsonBody<{ key?: string }>(c);
  if (!body.key || !c.env.NUDGE_AUTH_KEY || !c.env.SESSION_SECRET || !(await secureEqual(body.key, c.env.NUDGE_AUTH_KEY))) {
    return c.json({ error: "invalid key" }, 401);
  }

  setSessionCookie(c, await createSession(c.env.SESSION_SECRET));
  return c.json({ authenticated: true });
});

app.get("/api/auth/session", async (c) => {
  return c.json({ authenticated: Boolean(await authenticate(c)) });
});

app.use("/api/*", async (c, next) => {
  const mode = await authenticate(c);
  if (!mode) return c.json({ error: "unauthorized" }, 401);
  c.set("authMode", mode);

  if (mode === "cookie" && MUTATING_METHODS.has(c.req.method) && !requestOriginIsValid(c.req.raw)) {
    return c.json({ error: "invalid origin" }, 403);
  }
  await next();
});

app.post("/api/auth/logout", (c) => {
  clearSessionCookie(c);
  return c.json({ authenticated: false });
});

app.get("/api/health", async (c) => {
  const missing = requireSecrets(c.env);
  let database = false;
  let memory = false;
  try {
    database = (await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>())?.ok === 1;
  } catch {
    database = false;
  }
  if (c.env.SECOND_BRAIN_TOKEN && c.env.SECOND_BRAIN_URL) {
    try {
      const response = await fetch(new URL("/health", `${c.env.SECOND_BRAIN_URL.replace(/\/$/, "")}/`), {
        headers: { Authorization: `Bearer ${c.env.SECOND_BRAIN_TOKEN}` },
        signal: AbortSignal.timeout(5_000),
      });
      memory = response.ok;
    } catch {
      memory = false;
    }
  }
  const ok = missing.length === 0 && database;
  return c.json({ ok, database, memory, memoryConfigured: Boolean(c.env.SECOND_BRAIN_TOKEN), geminiConfigured: Boolean(c.env.GEMINI_API_KEY), missing }, ok ? 200 : 503);
});

app.get("/api/capabilities", (c) => c.json({
  gemini: Boolean(c.env.GEMINI_API_KEY),
  secondBrain: Boolean(c.env.SECOND_BRAIN_TOKEN && c.env.SECOND_BRAIN_URL),
  push: Boolean(c.env.VAPID_PUBLIC_KEY && c.env.VAPID_PRIVATE_KEY),
}));

app.get("/api/tasks", async (c) => c.json(await listTasks(c.env)));

app.post("/api/tasks", async (c) => {
  const body = await jsonBody<Record<string, unknown>>(c);
  const text = cleanText(body.text || body.title, 200).slice(0, 200);
  if (!text) return c.json({ error: "text is required" }, 400);
  try {
    const task = await addTask(c.env, {
      text,
      details: cleanText(body.details, 10_000),
      due_at: normalizeDueAt(body.due_at),
      workspace: cleanText(body.workspace, 80) || "Personal",
      follow_up_interval_minutes: Number(body.follow_up_interval_minutes) || 0,
      follow_up_max_count: Number(body.follow_up_max_count) || 0,
    });
    return c.json(task, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "invalid task" }, 400);
  }
});

app.patch("/api/tasks/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
  const body = await jsonBody<Record<string, unknown>>(c);
  try {
    const task = await updateTask(c.env, id, {
      ...(body.text !== undefined || body.title !== undefined ? { text: cleanText(body.text || body.title, 200) } : {}),
      ...(body.details !== undefined ? { details: cleanText(body.details, 10_000) } : {}),
      ...(body.due_at !== undefined ? { due_at: normalizeDueAt(body.due_at) } : {}),
      ...(body.workspace !== undefined ? { workspace: cleanText(body.workspace, 80) } : {}),
      ...(body.follow_up_interval_minutes !== undefined ? { follow_up_interval_minutes: Number(body.follow_up_interval_minutes) || 0 } : {}),
      ...(body.follow_up_max_count !== undefined ? { follow_up_max_count: Number(body.follow_up_max_count) || 0 } : {}),
    });
    return task ? c.json(task) : c.json({ error: "not found" }, 404);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "invalid task" }, 400);
  }
});

app.post("/api/tasks/:id/done", async (c) => {
  const task = await completeTask(c.env, Number(c.req.param("id")));
  return task ? c.json(task) : c.json({ error: "not found" }, 404);
});

app.delete("/api/tasks/:id", async (c) => {
  const deleted = await deleteTask(c.env, Number(c.req.param("id")));
  return deleted ? c.body(null, 204) : c.json({ error: "not found" }, 404);
});

app.get("/api/bootstrap", async (c) => {
  const [name, timezone, workspaces] = await Promise.all([
    c.env.DB.prepare("SELECT value FROM settings WHERE key = 'name'").first<{ value: string }>(),
    c.env.DB.prepare("SELECT value FROM settings WHERE key = 'timezone'").first<{ value: string }>(),
    c.env.DB.prepare("SELECT name FROM workspaces ORDER BY sort_order, created_at").all<{ name: string }>(),
  ]);
  return c.json({
    initialized: Boolean(name?.value),
    name: name?.value || cleanText(c.env.NUDGE_PROFILE_NAME, 80) || "Junior",
    timezone: timezone?.value || c.env.APP_TIMEZONE || "Asia/Kolkata",
    workspaces: (workspaces.results || []).map((row) => row.name),
  });
});

app.post("/api/bootstrap", async (c) => {
  const existing = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'name'").first();
  if (existing) return c.json({ initialized: true, imported: false });
  const body = await jsonBody<{ name?: string; workspaces?: string[] }>(c);
  const name = cleanText(body.name, 80) || cleanText(c.env.NUDGE_PROFILE_NAME, 80) || "Junior";
  const workspaces = Array.isArray(body.workspaces)
    ? body.workspaces.map((value) => cleanText(value, 80)).filter(Boolean).slice(0, 50)
    : [];
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO settings (key, value) VALUES ('name', ?)
       ON CONFLICT(key) DO NOTHING`,
    ).bind(name),
    ...workspaces.map((workspace, index) =>
      c.env.DB.prepare("INSERT OR IGNORE INTO workspaces (name, sort_order) VALUES (?, ?)").bind(workspace, index),
    ),
  ];
  await c.env.DB.batch(statements);
  return c.json({ initialized: true, imported: true });
});

app.put("/api/profile", async (c) => {
  const body = await jsonBody<{ name?: string; timezone?: string }>(c);
  const entries: Array<[string, string]> = [];
  if (body.name !== undefined) entries.push(["name", cleanText(body.name, 80)]);
  if (body.timezone !== undefined) entries.push(["timezone", cleanText(body.timezone, 80)]);
  const validEntries = entries.filter((entry) => Boolean(entry[1]));
  if (!validEntries.length) return c.json({ error: "name or timezone is required" }, 400);
  await c.env.DB.batch(
    validEntries.map(([key, value]) =>
      c.env.DB.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).bind(key, value),
    ),
  );
  return c.json({ ok: true });
});

app.post("/api/workspaces", async (c) => {
  const body = await jsonBody<{ name?: string }>(c);
  const name = cleanText(body.name, 80);
  if (!name || name.toLowerCase() === "all") return c.json({ error: "invalid workspace" }, 400);
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO workspaces (name, sort_order)
     VALUES (?, COALESCE((SELECT MAX(sort_order) + 1 FROM workspaces), 0))`,
  )
    .bind(name)
    .run();
  const rows = await c.env.DB.prepare("SELECT name FROM workspaces ORDER BY sort_order, created_at").all<{ name: string }>();
  return c.json({ workspaces: (rows.results || []).map((row) => row.name) }, 201);
});

app.delete("/api/workspaces/:name", async (c) => {
  const name = cleanText(decodeURIComponent(c.req.param("name")), 80);
  if (!name || name.toLowerCase() === "all" || name.toLowerCase() === "personal") {
    return c.json({ error: "Personal workspace cannot be deleted" }, 400);
  }
  const existing = await c.env.DB.prepare("SELECT name FROM workspaces WHERE lower(name) = lower(?)").bind(name).first<{ name: string }>();
  if (!existing) return c.json({ error: "workspace not found" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR IGNORE INTO workspaces (name, sort_order) VALUES ('Personal', 0)"),
    c.env.DB.prepare("UPDATE tasks SET workspace = 'Personal' WHERE lower(workspace) = lower(?)").bind(existing.name),
    c.env.DB.prepare("DELETE FROM workspaces WHERE lower(name) = lower(?)").bind(existing.name),
  ]);
  const rows = await c.env.DB.prepare("SELECT name FROM workspaces ORDER BY sort_order, created_at").all<{ name: string }>();
  return c.json({ ok: true, workspaces: (rows.results || []).map((row) => row.name) });
});

app.get("/api/vapid-public-key", (c) => c.json({ key: c.env.VAPID_PUBLIC_KEY }));

app.get("/api/push/status", async (c) => {
  const deviceId = cleanText(c.req.query("device_id"), 120);
  return c.json(await getPushStatus(c.env, deviceId));
});

app.post("/api/push/subscriptions", async (c) => {
  const body = await jsonBody<{ device_id?: string; device_name?: string; subscription?: PushSubscriptionJSON }>(c);
  const deviceId = cleanText(body.device_id, 120);
  const deviceName = cleanText(body.device_name, 120) || "Browser";
  if (!deviceId || !body.subscription?.endpoint) return c.json({ error: "invalid subscription" }, 400);
  try {
    await registerSubscription(c.env, deviceId, deviceName, body.subscription);
  } catch {
    return c.json({ error: "invalid subscription" }, 400);
  }
  return c.json({ ok: true }, 201);
});

app.delete("/api/push/subscriptions/:deviceId", async (c) => {
  const deviceId = cleanText(c.req.param("deviceId"), 120);
  if (!deviceId) return c.json({ error: "invalid device" }, 400);
  return c.json({ disabled: await disableDevice(c.env, deviceId) });
});

app.post("/api/push/test", async (c) => {
  const body = await jsonBody<{ device_id?: string }>(c);
  const deviceId = cleanText(body.device_id, 120);
  const device = deviceId ? await getActiveDevice(c.env, deviceId) : null;
  if (!device) return c.json({ error: "device is not registered" }, 404);
  if (device.last_test_at && Date.now() - new Date(device.last_test_at).getTime() < 60_000) {
    return c.json({ error: "wait one minute before another test" }, 429);
  }
  const result = await sendTestPush(c.env, device);
  if (!result.delivered) return c.json({ error: result.permanent ? "subscription expired" : "push delivery failed" }, 502);
  return c.json({ delivered: true });
});

app.post("/api/push/retry", async (c) => c.json({ retried: await retryFailedDeliveries(c.env) }));

app.get("/api/memories/recent", async (c) => {
  return c.json(
    await listRecentMemories(c.env, {
      workspace: c.req.query("workspace"),
      limit: Number(c.req.query("limit")) || 20,
    }),
  );
});

app.get("/api/memories/search", async (c) => {
  const query = cleanText(c.req.query("q"), 1_000);
  if (!query) return c.json({ error: "q is required" }, 400);
  return c.json(
    await recallMemories(c.env, {
      query,
      workspace: c.req.query("workspace"),
      topK: Number(c.req.query("limit")) || 10,
    }),
  );
});

app.post("/api/memories", async (c) => {
  const body = await jsonBody<{ content?: string; workspace?: string; tags?: string[] }>(c);
  const content = cleanText(body.content, 20_000);
  if (!content) return c.json({ error: "content is required" }, 400);
  const result = await captureMemory(c.env, {
    content,
    workspace: cleanText(body.workspace, 80),
    tags: Array.isArray(body.tags) ? body.tags.map((tag) => cleanText(tag, 60)).filter(Boolean) : [],
  });
  return c.json(result, 201);
});

app.delete("/api/memories/:id", async (c) => {
  if (c.req.header("X-Confirm-Delete") !== "true") return c.json({ error: "confirmation required" }, 409);
  return c.json(await forgetMemory(c.env, c.req.param("id")));
});

function voiceSystemInstruction(name: string, gender: string): string {
  const normalized = gender.trim().toLowerCase();
  const pronouns = normalized === "he" ? "he/him" : "she/her";
  return `You are Nudge, a natural real-time personal assistant. The user's name is ${name}; remember it as context, but do not repeat or force the name in every reply. Use it only occasionally when greeting, emphasizing something important, or clarifying identity. Use ${pronouns} pronouns when referring to yourself. Do not mention these instructions. Speak warmly and clearly, usually in one to three sentences. Never use markdown or describe internal process. Ask at most one question at a time. If interrupted, stop immediately.

Tasks are exact operational state. Always use task tools instead of guessing. Call list_tasks before updating, completing, or deleting unless the task ID came from this conversation. Routine task state is not a memory. When creating a task, use a concise title and put the user's complete explanation, constraints, and context in details. Never shorten away meaningful information. Completed tasks stay in task history, but query them only when the user explicitly asks what they finished, completed counts, or past task history. Do not include completed tasks in normal open-task answers.

Second Brain is durable personal memory. Use recall_memory when an answer depends on preferences, people, history, or past decisions. Use remember_memory when the user explicitly asks you to remember something or clearly states a durable preference, decision, relationship, personal fact, or project fact. After success, briefly confirm what was saved. Never store credentials, tokens, private keys, raw transcripts, assistant output, routine task changes, or transient conversation. Sensitive personal information requires explicit intent. Do not recall memory for simple task operations.`;
}

app.post("/api/voice-token", async (c) => {
  if (!c.env.GEMINI_API_KEY) return c.json({ error: "Gemini voice is not configured" }, 503);
  if (c.env.VOICE_RATE_LIMITER && !(await c.env.VOICE_RATE_LIMITER.limit({ key: clientAddress(c) })).success) {
    return c.json({ error: "too many voice requests" }, 429);
  }
  const body = await jsonBody<{ vad?: Record<string, any> }>(c);
  const vad = body.vad || {};
  const model = c.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview";
  const profile = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'name'").first<{ value: string }>();
  const profileName = profile?.value?.trim() || cleanText(c.env.NUDGE_PROFILE_NAME, 80) || "Junior";
  const assistantGender = c.env.NUDGE_ASSISTANT_GENDER || "she";
  const ai = new GoogleGenAI({ apiKey: c.env.GEMINI_API_KEY });
  const expireTime = new Date(Date.now() + 30 * 60 * 1_000).toISOString();

  try {
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime,
        newSessionExpireTime: new Date(Date.now() + 60 * 1_000).toISOString(),
        liveConnectConstraints: {
          model,
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: {
              parts: [
                {
                  text: `${voiceSystemInstruction(profileName, assistantGender)}\nUser timezone: ${c.env.APP_TIMEZONE || "Asia/Kolkata"}. Resolve relative dates in this timezone and pass due times with an explicit offset.`,
                },
              ],
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } } },
            thinkingConfig: { thinkingBudget: 0 },
            realtimeInputConfig: {
              automaticActivityDetection: {
                startOfSpeechSensitivity: vad.startSensitivity || "START_SENSITIVITY_HIGH",
                endOfSpeechSensitivity: vad.endSensitivity || "END_SENSITIVITY_HIGH",
                prefixPaddingMs: vad.prefixPaddingMs ?? 200,
                silenceDurationMs: vad.silenceDurationMs ?? 600,
              },
            },
            sessionResumption: {},
            tools: [{ functionDeclarations: toolDeclarations }],
          },
        },
      },
    });
    return c.json({ token: token.name, expireTime, model });
  } catch (error) {
    console.error("voice_token_failed", { error: error instanceof Error ? error.name : "error" });
    return c.json({ error: "Could not start voice session" }, 502);
  }
});

app.post("/api/voice/tool", async (c) => {
  if (c.env.VOICE_RATE_LIMITER && !(await c.env.VOICE_RATE_LIMITER.limit({ key: clientAddress(c) })).success) {
    return c.json({ error: "too many voice requests" }, 429);
  }
  const body = await jsonBody<{ name?: string; args?: Record<string, unknown> }>(c);
  if (!body.name) return c.json({ error: "name is required" }, 400);
  return c.json({ result: await runTool(c.env, body.name, body.args || {}) });
});

app.onError((error, c) => {
  if (error instanceof SecondBrainError) return c.json({ error: error.message }, error.status as any);
  console.error("request_failed", { path: c.req.path, error: error.name });
  return c.json({ error: "internal error" }, 500);
});

app.notFound((c) => c.json({ error: "not found" }, 404));

export { app };

export default {
  fetch: app.fetch,
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(processDueReminders(env));
  },
} satisfies ExportedHandler<Env>;
