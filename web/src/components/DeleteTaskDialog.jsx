import { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";

export default function DeleteTaskDialog({ task, onClose, onConfirm }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const close = (event) => event.key === "Escape" && !deleting && onClose();
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [deleting, onClose]);

  async function confirm() {
    setDeleting(true);
    setError("");
    try {
      await onConfirm(task);
      onClose();
    } catch (caught) {
      setError(caught.message || "Could not delete task");
      setDeleting(false);
    }
  }

  return <div className="task-delete-overlay" role="dialog" aria-modal="true" aria-labelledby="task-delete-title" onMouseDown={(event) => event.target === event.currentTarget && !deleting && onClose()}>
    <section className="task-delete-dialog">
      <header><div className="task-delete-icon"><Trash2 size={20} /></div><button type="button" onClick={onClose} disabled={deleting} aria-label="Close delete dialog"><X size={18} /></button></header>
      <div className="task-delete-copy"><h2 id="task-delete-title">Delete this task?</h2><p>“{task.text}” will be permanently removed. This action cannot be undone.</p></div>
      {error && <p className="task-delete-error" role="alert">{error}</p>}
      <footer><button type="button" className="cancel" onClick={onClose} disabled={deleting}>Keep task</button><button type="button" className="danger" onClick={confirm} disabled={deleting}><Trash2 size={15} /> {deleting ? "Deleting…" : "Delete task"}</button></footer>
    </section>
  </div>;
}
