import { describe, expect, it, vi } from "vitest";
import { runTool } from "./tools";
import type { Env, TaskRow } from "./types";

const rows: TaskRow[] = [
  {
    id: 1, text: "Ship landing page", due_at: null, notified_at: null,
    done_at: "2026-08-06T10:00:00.000Z", workspace: "Startup", created_at: "2026-08-01T10:00:00.000Z",
    details: "", follow_up_interval_minutes: 0, follow_up_max_count: 0, notification_count: 0,
    last_notification_at: null, next_notification_at: null,
  },
  {
    id: 2, text: "Call Vikas", due_at: null, notified_at: null,
    done_at: null, workspace: "Personal", created_at: "2026-08-02T10:00:00.000Z",
    details: "", follow_up_interval_minutes: 0, follow_up_max_count: 0, notification_count: 0,
    last_notification_at: null, next_notification_at: null,
  },
];

function envWithRows() {
  return {
    DB: { prepare: vi.fn(() => ({ all: vi.fn(async () => ({ results: rows })) })) },
    APP_TIMEZONE: "Asia/Kolkata",
  } as unknown as Env;
}

describe("completed task voice history", () => {
  it("keeps completed tasks out of normal open-task results", async () => {
    const result = await runTool(envWithRows(), "list_tasks", { filter: "all" });
    expect(result.tasks.map((task: TaskRow) => task.id)).toEqual([2]);
  });

  it("returns completed tasks only for explicit history queries and applies dates", async () => {
    const result = await runTool(envWithRows(), "list_tasks", {
      filter: "completed",
      completed_after: "2026-08-06T00:00:00.000Z",
      completed_before: "2026-08-06T23:59:59.999Z",
    });
    expect(result.count).toBe(1);
    expect(result.tasks[0]).toMatchObject({ id: 1, done_at: "2026-08-06T10:00:00.000Z" });
  });
});
