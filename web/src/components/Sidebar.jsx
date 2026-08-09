import { Home, Bell, CalendarDays, Plus, Check, Brain, Mail } from "lucide-react";
import { useState } from "react";
import Logo from "./Logo.jsx";
import ProfileMenu from "./ProfileMenu.jsx";
import WorkspaceActions from "./WorkspaceActions.jsx";

export default function Sidebar({
  name,
  workspaces,
  activeWorkspace,
  onSelectWorkspace,
  onAddWorkspace,
  onManageWorkspace,
  workspaceColors = {},
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
        {capabilities.email && <button className={view === "email" ? "active" : ""} onClick={() => onNavigate("email")}>
          <Mail size={16} /> Email
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

        {workspaces.map((ws) => (
          <div className={`ws-item-row ${activeWorkspace === ws ? "active" : ""}`} key={ws}>
            <button className="ws-item" onClick={() => onSelectWorkspace(ws)}>
              <span className="ws-dot" style={{ backgroundColor: workspaceColors[ws] }} />
              <span className="ws-name">{ws}</span>
              <span className="ws-count">{counts[ws] || 0}</span>
            </button>
            <WorkspaceActions workspace={ws} onAction={onManageWorkspace} />
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
      <ProfileMenu name={name} detail={`${totalOpen} open · ${doneToday} done today`} onSettings={() => onNavigate("settings")} onLogout={onLogout} />
    </aside>
  );
}
