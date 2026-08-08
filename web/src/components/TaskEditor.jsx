import { useState } from "react";
import { X } from "lucide-react";

export default function TaskEditor({ task, workspaces, onClose, onSave }) {
  const [title, setTitle] = useState(task.text || "");
  const [details, setDetails] = useState(task.details || "");
  const [due, setDue] = useState(task.due_at ? task.due_at.slice(0, 16) : "");
  const [workspace, setWorkspace] = useState(task.workspace || "Personal");
  const [interval, setInterval] = useState(task.follow_up_interval_minutes || 0);
  const [max, setMax] = useState(task.follow_up_max_count || 0);
  const [saving, setSaving] = useState(false);
  async function submit(event) { event.preventDefault(); if (!title.trim()) return; setSaving(true); try { await onSave({ text: title.trim(), details, due_at: due, workspace, follow_up_interval_minutes: Number(interval), follow_up_max_count: Number(max) }); } finally { setSaving(false); } }
  return <div className="editor-overlay" role="dialog" aria-modal="true" aria-label="Edit task">
    <form className="task-editor" onSubmit={submit}>
      <div className="editor-head"><h2>Edit task</h2><button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
      <label>Title<input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>Details<textarea value={details} maxLength={10000} onChange={(e) => setDetails(e.target.value)} /></label>
      <div className="editor-grid"><label>Deadline<input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></label><label>Workspace<select value={workspace} onChange={(e) => setWorkspace(e.target.value)}>{workspaces.map((name) => <option key={name}>{name}</option>)}</select></label></div>
      <div className="editor-grid"><label>Follow-up interval<select value={interval} onChange={(e) => setInterval(e.target.value)}><option value="0">Off</option><option value="5">5 minutes</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="120">2 hours</option><option value="1440">1 day</option></select></label><label>Additional nudges<select value={max} onChange={(e) => setMax(e.target.value)}>{[0,1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label></div>
      <div className="editor-actions"><button type="button" onClick={onClose}>Cancel</button><button className="editor-save" disabled={saving || !title.trim()}>{saving ? "Saving…" : "Save task"}</button></div>
    </form>
  </div>;
}
