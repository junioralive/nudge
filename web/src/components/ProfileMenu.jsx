import { useEffect, useRef, useState } from "react";
import { LockKeyhole, Settings2 } from "lucide-react";

export default function ProfileMenu({ name, detail, compact = false, onSettings, onLogout }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const initial = name.trim().charAt(0).toUpperCase() || "N";

  useEffect(() => {
    function close(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  function choose(action) {
    setOpen(false);
    action();
  }

  return (
    <div className={`profile-menu ${compact ? "compact" : ""}`} ref={rootRef}>
      <button className="profile-trigger" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label="Open profile menu">
        <span className="avatar">{initial}</span>
        {!compact && <span className="profile-trigger-copy"><strong>{name}</strong><small>{detail}</small></span>}
      </button>
      {open && <div className="profile-popover">
        <div className="profile-popover-head"><span className="avatar">{initial}</span><div><strong>{name}</strong><small>Your Nudge profile</small></div></div>
        <button type="button" onClick={() => choose(onSettings)}><Settings2 size={15} /> Settings</button>
        <button type="button" onClick={() => choose(onLogout)}><LockKeyhole size={15} /> Lock Nudge</button>
      </div>}
    </div>
  );
}
