import { describe, expect, it, vi } from "vitest";
import { updateTask } from "./data";
import type { Env, TaskRow } from "./types";

const existing: TaskRow = {
  id: 7,
  text: "Call Vikas",
  details: "",
  due_at: "2026-08-10T06:00:00.000Z",
  workspace: "Personal",
  notified_at: null,
  done_at: null,
  created_at: "2026-08-09T10:00:00.000Z",
  notification_claimed_at: null,
  notification_attempts: 0,
  next_retry_at: null,
  notification_body: "Call Vikas",
  follow_up_interval_minutes: 0,
  follow_up_max_count: 0,
  notification_count: 0,
  last_notification_at: null,
  next_notification_at: null,
};

describe("task updates", () => {
  it("binds every reset parameter when a deadline changes", async () => {
    let updateBindings: unknown[] = [];
    const db = {
      prepare: vi.fn((sql: string) => {
        const statement = {
          bind: vi.fn((...values: unknown[]) => {
            if (sql.startsWith("UPDATE tasks")) updateBindings = values;
            return statement;
          }),
          first: vi.fn(async () => (sql.startsWith("SELECT * FROM tasks") ? existing : null)),
          run: vi.fn(async () => ({ meta: { changes: 1 } })),
        };
        return statement;
      }),
      batch: vi.fn(async () => [{ meta: { changes: 1 } }]),
    };

    const updated = await updateTask({ DB: db } as unknown as Env, existing.id, {
      due_at: "2026-08-10T18:00:00.000Z",
    });

    expect(updateBindings).toHaveLength(12);
    expect(updateBindings.at(-1)).toBe(existing.id);
    expect(updated?.due_at).toBe(existing.due_at);
  });
});
