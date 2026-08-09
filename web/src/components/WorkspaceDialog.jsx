import { useEffect, useState } from "react";
import { X } from "lucide-react";

export const WORKSPACE_COLORS = ["#E787FF", "#FFC66D", "#6FD69A", "#7FB2FF", "#FF9BC2", "#A99AF2"];

export default function WorkspaceDialog({ dialog, currentColor, onClose, onConfirm }) {
  const [name, setName] = useState(dialog.workspace);
  const [color, setColor] = useState(currentColor || WORKSPACE_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isDelete = dialog.mode === "delete";
  const title = dialog.mode === "edit" ? "Edit workspace" : dialog.mode === "color" ? "Workspace color" : "Delete workspace";

  useEffect(() => {
    const close = (event) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onConfirm(dialog.mode === "edit" ? { name: name.trim() } : dialog.mode === "color" ? { color } : {});
      onClose();
    } catch (caught) {
      setError(caught.message || "Could not update workspace");
    } finally {
      setSaving(false);
    }
  }

  return <div className="workspace-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="workspace-dialog-title" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="workspace-dialog-shell">
      <header className="workspace-dialog-head"><h2 id="workspace-dialog-title">{title}</h2><button type="button" className="settings-close" onClick={onClose} aria-label="Close workspace dialog"><X size={18} /></button></header>
      <form className="workspace-dialog-card" onSubmit={submit}>
        {dialog.mode === "edit" && <label><span>Workspace name</span><input autoFocus maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label>}
        {dialog.mode === "color" && <fieldset><legend>Choose a color for {dialog.workspace}</legend><div className="workspace-color-grid">
          {WORKSPACE_COLORS.map((option) => <button type="button" key={option} className={color === option ? "active" : ""} style={{ "--workspace-color": option }} onClick={() => setColor(option)} aria-label={`Select ${option}`} aria-pressed={color === option}><span /> </button>)}
        </div></fieldset>}
        {isDelete && <div className="workspace-delete-warning"><h3>Delete “{dialog.workspace}”?</h3><p>Its tasks will move to Personal. This cannot be undone.</p></div>}
        {error && <p className="workspace-dialog-error" role="alert">{error}</p>}
        <div className="workspace-dialog-actions"><button type="button" onClick={onClose}>Cancel</button><button className={isDelete ? "danger" : "primary"} disabled={saving || (dialog.mode === "edit" && !name.trim())}>{saving ? "Saving…" : isDelete ? "Delete workspace" : dialog.mode === "color" ? "Save color" : "Save workspace"}</button></div>
      </form>
    </div>
  </div>;
}
