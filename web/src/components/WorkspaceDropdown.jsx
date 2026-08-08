import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Plus, Trash2 } from "lucide-react";

export default function WorkspaceDropdown({ workspaces, active, onSelect, onAdd, onDelete }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + window.scrollY + 8, left: rect.left + window.scrollX });
  }, [open]);

  useEffect(() => {
    function handleClick(e) {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        menuRef.current && !menuRef.current.contains(e.target)
      ) {
        setOpen(false);
        setAdding(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function pick(ws) {
    onSelect(ws);
    setOpen(false);
  }

  function submitAdd() {
    const name = draft.trim();
    if (name) {
      onAdd(name);
      onSelect(name);
    }
    setDraft("");
    setAdding(false);
    setOpen(false);
  }

  return (
    <span className="ws-dropdown">
      <button
        ref={triggerRef}
        className="ws-dropdown-trigger"
        onClick={() => setOpen((o) => !o)}
      >
        {active === "All" ? "Nudge" : active}
        <ChevronDown size={16} className={`chev ${open ? "open" : ""}`} />
      </button>

      {open &&
        createPortal(
          <div
            className="ws-dropdown-menu"
            ref={menuRef}
            style={{ top: pos.top, left: pos.left }}
          >
            <button
              className={`ws-dropdown-item ${active === "All" ? "active" : ""}`}
              onClick={() => pick("All")}
            >
              All
            </button>
            {workspaces.map((ws) => (
              <div className={`ws-dropdown-row ${active === ws ? "active" : ""}`} key={ws}>
                <button className="ws-dropdown-item" onClick={() => pick(ws)}>{ws}</button>
                {ws !== "Personal" && <button className="ws-dropdown-delete" onClick={() => onDelete?.(ws)} aria-label={`Delete ${ws}`} title="Delete workspace"><Trash2 size={13} /></button>}
              </div>
            ))}
            {adding ? (
              <input
                className="ws-dropdown-input"
                autoFocus
                placeholder="Workspace name"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={submitAdd}
                onKeyDown={(e) => e.key === "Enter" && submitAdd()}
              />
            ) : (
              <button className="ws-dropdown-item ws-dropdown-add" onClick={() => setAdding(true)}>
                <Plus size={13} /> New workspace
              </button>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
