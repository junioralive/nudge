import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, Palette, Pencil, Trash2 } from "lucide-react";

export default function WorkspaceActions({ workspace, onAction }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const protectedWorkspace = workspace.toLowerCase() === "personal";

  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 178;
    setPosition({ top: rect.bottom + 6, left: Math.max(10, Math.min(rect.right - width, window.innerWidth - width - 10)) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event) => {
      if (event.key === "Escape" || (!triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target))) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  function choose(action) {
    setOpen(false);
    onAction?.(action, workspace);
  }

  return <>
    <button ref={triggerRef} type="button" className="workspace-more-btn" onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }} aria-label={`Workspace options for ${workspace}`} aria-expanded={open}>
      <MoreHorizontal size={15} />
    </button>
    {open && createPortal(<div ref={menuRef} className="workspace-actions-menu" style={position} role="menu" onMouseDown={(event) => event.stopPropagation()}>
      {!protectedWorkspace && <button type="button" onClick={() => choose("edit")} role="menuitem"><Pencil size={14} /> Edit workspace</button>}
      <button type="button" onClick={() => choose("color")} role="menuitem"><Palette size={14} /> Change color</button>
      {!protectedWorkspace && <button type="button" className="danger" onClick={() => choose("delete")} role="menuitem"><Trash2 size={14} /> Delete workspace</button>}
    </div>, document.body)}
  </>;
}
