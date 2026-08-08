import { useState } from "react";

export default function NameEditor({ name, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed) onChange(trimmed);
    else setDraft(name);
  }

  if (editing) {
    return (
      <input
        className="name-editor-input"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
    );
  }

  return (
    <span
      className="name-editable"
      onClick={() => {
        setDraft(name);
        setEditing(true);
      }}
      title="Click to edit your name"
    >
      {name}
    </span>
  );
}
