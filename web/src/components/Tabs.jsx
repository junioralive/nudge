export default function Tabs({ value, onChange }) {
  return (
    <div className="tabs">
      <button className={value === "today" ? "active" : ""} onClick={() => onChange("today")}>
        Today
      </button>
      <button className={value === "all" ? "active" : ""} onClick={() => onChange("all")}>
        All tasks
      </button>
      <button className={value === "completed" ? "active" : ""} onClick={() => onChange("completed")}>
        Completed
      </button>
    </div>
  );
}
import React from "react";
