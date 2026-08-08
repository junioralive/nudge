import { ArrowUpDown } from "lucide-react";

export default function AgendaHeader({ sortByDue, onToggleSort, completed = false }) {
  return (
    <div className="agenda-header">
      <span className="section-title">{completed ? "Completed tasks" : "Your agenda"}</span>
      {!completed && <div className="actions">
        <button className="icon-pill" onClick={onToggleSort}>
          <ArrowUpDown size={13} />
          {sortByDue ? "By due time" : "Newest"}
        </button>
      </div>}
    </div>
  );
}
import React from "react";
