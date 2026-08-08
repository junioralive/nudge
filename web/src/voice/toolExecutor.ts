import { voiceLog } from "./logger.js";

// The browser holds the Gemini Live connection directly now (via ephemeral
// token), so when Gemini emits a tool call, we're the ones who have to fulfil
// it. We don't touch the database from here though — that logic (and the
// filter/workspace rules) stays server-side in tools.js; this just forwards
// the call and relays the result back.
export async function executeTool(name: string, args: Record<string, unknown>, context: { workspace?: string } = {}): Promise<unknown> {
  voiceLog.toolCall(name, args);
  const toolArgs = name === "remember_memory" && !args.workspace && context.workspace && context.workspace !== "All"
    ? { ...args, workspace: context.workspace }
    : args;
  const res = await fetch("/api/voice/tool", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, args: toolArgs }),
  });
  const body = (await res.json()) as { result?: unknown; error?: string };
  return body.result ?? { error: body.error || "tool execution failed" };
}
