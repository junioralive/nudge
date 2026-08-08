import { Home, Bell, CalendarDays, Plus, Check, Mic, Brain, LogOut, Trash2 } from "lucide-react";
import { useState } from "react";
import NameEditor from "./NameEditor.jsx";
import Logo from "./Logo.jsx";

const DOT_TONES = ["dot-purple", "dot-amber", "dot-mint", "dot-blue", "dot-rose"];

export default function Sidebar({
  name,
  onNameChange,
  workspaces,
  activeWorkspace,
  onSelectWorkspace,
  onAddWorkspace,
  onDeleteWorkspace,
  pushEnabled,
  onAdd,
  counts,
  totalOpen,
  doneToday,
  view,
  onNavigate,
  onTalk,
  onLogout,
  capabilities = {},
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  function submitAdd() {
    const value = draft.trim();
    if (value) {
      onAddWorkspace(value);
      onSelectWorkspace(value);
    }
    setDraft("");
    setAdding(false);
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <Logo size={22} />
        Nudge
      </div>

      <div className="sidebar-user">
        <span className="avatar">{name.trim().charAt(0).toUpperCase()}</span>
        <span className="sidebar-user-text">
          <NameEditor name={name} onChange={onNameChange} />
          <small>{totalOpen} open · {doneToday} done today</small>
        </span>
      </div>

      <nav className="sidebar-nav">
        <button className={view === "home" ? "active" : ""} onClick={() => onNavigate("home")}>
          <Home size={16} /> Home
        </button>
        <button onClick={onAdd}>
          <Plus size={16} /> Add task
        </button>
        <button
          onClick={() => onNavigate("notifications")}
          className={`${pushEnabled ? "on" : ""} ${view === "notifications" ? "active" : ""}`}
        >
          <Bell size={16} /> Notifications
          {pushEnabled && <Check size={13} className="nav-check" />}
        </button>
        <button className={view === "calendar" ? "active" : ""} onClick={() => onNavigate("calendar")}>
          <CalendarDays size={16} /> Calendar
        </button>
        {capabilities.secondBrain && <button className={view === "memories" ? "active" : ""} onClick={() => onNavigate("memories")}>
          <Brain size={16} /> Memories
        </button>}
      </nav>

      <div className="sidebar-section-label">Workspaces</div>

      <div className="ws-list">
        <button
          className={`ws-item ${activeWorkspace === "All" ? "active" : ""}`}
          onClick={() => onSelectWorkspace("All")}
        >
          <span className="ws-dot dot-all" />
          <span className="ws-name">All</span>
          <span className="ws-count">{totalOpen}</span>
        </button>

        {workspaces.map((ws, i) => (
          <div className={`ws-item-row ${activeWorkspace === ws ? "active" : ""}`} key={ws}>
            <button className="ws-item" onClick={() => onSelectWorkspace(ws)}>
              <span className={`ws-dot ${DOT_TONES[i % DOT_TONES.length]}`} />
              <span className="ws-name">{ws}</span>
              <span className="ws-count">{counts[ws] || 0}</span>
            </button>
            {ws !== "Personal" && <button className="ws-delete-btn" onClick={() => onDeleteWorkspace?.(ws)} aria-label={`Delete ${ws}`} title="Delete workspace"><Trash2 size={13} /></button>}
          </div>
        ))}

        {adding ? (
          <input
            className="ws-add-input"
            autoFocus
            placeholder="Workspace name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={submitAdd}
            onKeyDown={(e) => e.key === "Enter" && submitAdd()}
          />
        ) : (
          <button className="ws-item ws-add" onClick={() => setAdding(true)}>
            <Plus size={14} /> New workspace
          </button>
        )}
      </div>

      {capabilities.gemini && <button className="talk-nav-btn" onClick={onTalk}>
        <Mic size={16} /> Talk to Nudge
      </button>}
      <button className="logout-nav-btn" onClick={onLogout}>
        <LogOut size={15} /> Lock Nudge
      </button>
    </aside>
  );
}
