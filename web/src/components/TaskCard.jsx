import { Check, Clock, Pencil, Trash2 } from "lucide-react";

function formatDue(dueAt) {
  if (!dueAt) return null;
  const d = new Date(dueAt.includes("T") ? dueAt : dueAt.replace(" ", "T"));
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function TaskCard({ task, tone, onComplete, onEdit, onDelete, index = 0 }) {
  const due = formatDue(task.due_at);
  const completed = Boolean(task.done_at);
  return (
    <div
      id={`task-${task.id}`}
      className={`task-card ${tone}`}
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
    >
      <div className="row-top">
        <div className="text" onClick={() => onEdit?.(task)}>{task.text}</div>
        <button className={`done-btn ${completed ? "completed" : ""}`} onClick={() => !completed && onComplete?.(task.id)} aria-label={completed ? "Completed" : "Mark done"} disabled={completed}>
          <Check size={15} />
        </button>
      </div>
      <div className="row-bottom">
        {due ? (
          <span className="due-badge">
            <Clock size={11} />
            {due}
          </span>
        ) : (
          <span className="no-due-badge">No due time</span>
        )}
        {completed && <span className="completed-at">Completed {formatDue(task.done_at)}</span>}
        <span className="workspace-tag">{task.workspace || "Personal"}</span>
        {onEdit && <button className="edit-task-btn" onClick={() => onEdit(task)} aria-label="Edit task"><Pencil size={12} /></button>}
        {onDelete && <button className="delete-task-btn" onClick={() => onDelete(task)} aria-label="Delete completed task" title="Delete completed task"><Trash2 size={13} /></button>}
      </div>
      {task.details && <details className="task-details"><summary>Details</summary><p>{task.details}</p></details>}
    </div>
  );
}
import React from "react";
