import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

export default function WorkspaceSwitcher({ workspaces, active, onSelect, onAdd, onDelete, vertical, className = "" }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  function submitAdd() {
    const name = draft.trim();
    if (name) {
      onAdd(name);
      onSelect(name);
    }
    setDraft("");
    setAdding(false);
  }

  return (
    <div className={`workspace-switcher ${vertical ? "vertical" : ""} ${className}`}>
      <button className={active === "All" ? "active" : ""} onClick={() => onSelect("All")}>
        All
      </button>
      {workspaces.map((ws) => (
        <span className="workspace-switcher-item" key={ws}>
          <button className={active === ws ? "active" : ""} onClick={() => onSelect(ws)}>{ws}</button>
          {ws !== "Personal" && <button className="workspace-delete-btn" onClick={() => onDelete?.(ws)} aria-label={`Delete ${ws}`} title="Delete workspace"><Trash2 size={12} /></button>}
        </span>
      ))}
      {adding ? (
        <input
          className="workspace-add-input"
          autoFocus
          placeholder="New workspace"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={submitAdd}
          onKeyDown={(e) => e.key === "Enter" && submitAdd()}
        />
      ) : (
        <button className="workspace-add-btn" onClick={() => setAdding(true)} aria-label="Add workspace">
          <Plus size={13} />
        </button>
      )}
    </div>
  );
}
