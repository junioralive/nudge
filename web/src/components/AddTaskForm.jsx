import { useRef, useState } from "react";
import { Plus, Clock, CalendarDays, X } from "lucide-react";

export default function AddTaskForm({ onAdd, inputRef, workspaces, defaultWorkspace }) {
  const [text, setText] = useState("");
  const [details, setDetails] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dueAt, setDueAt] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("09:00");
  const [workspace, setWorkspace] = useState(defaultWorkspace);

  function handleSubmit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    onAdd(text.trim(), dueAt, workspace, { details });
    setText("");
    setDueAt("");
    setDetails("");
    setDetailsOpen(false);
    setPickerOpen(false);
  }

  function applyDueDate() {
    setDueAt(dueDate ? `${dueDate}T${dueTime || "09:00"}` : "");
    setPickerOpen(false);
  }

  function clearDueDate() {
    setDueAt("");
    setDueDate("");
    setDueTime("09:00");
    setPickerOpen(false);
  }

  return (
    <form className="add-form" onSubmit={handleSubmit}>
      <input
        ref={inputRef}
        type="text"
        placeholder="Add a task or idea..."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="button" className="details-toggle" onClick={() => setDetailsOpen((open) => !open)}> {detailsOpen ? "Hide details" : "Add details"}</button>
      {detailsOpen && <textarea className="task-details-input" placeholder="Keep the full context, constraints, or notes…" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={10000} />}
      <select
        className="workspace-select"
        value={workspace}
        onChange={(e) => setWorkspace(e.target.value)}
        title="Workspace"
      >
        {workspaces.map((ws) => (
          <option key={ws} value={ws}>
            {ws}
          </option>
        ))}
      </select>
      <button type="button" className={`due-chip ${dueAt ? "has-due" : ""}`} onClick={() => setPickerOpen((open) => !open)}>
        <Clock size={12} />
        {dueAt
          ? new Date(dueAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
          : "No due time"}
      </button>
      {pickerOpen && (
        <div className="due-picker" role="dialog" aria-label="Set due date and time">
          <div className="due-picker-head">
            <span><CalendarDays size={15} /> Set due date</span>
            <button type="button" className="due-picker-close" onClick={() => setPickerOpen(false)} aria-label="Close"><X size={15} /></button>
          </div>
          <label>Date<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
          <label>Time<input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} /></label>
          <div className="due-picker-actions">
            <button type="button" onClick={clearDueDate}>Clear</button>
            <button type="button" className="due-apply" onClick={applyDueDate} disabled={!dueDate}>Apply</button>
          </div>
        </div>
      )}
      <button type="submit" className="submit-btn" aria-label="Add task">
        <Plus size={18} />
      </button>
    </form>
  );
}
