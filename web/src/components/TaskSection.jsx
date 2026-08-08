import TaskCard from "./TaskCard.jsx";

export default function TaskSection({ label, tasks, tone, onComplete, onEdit }) {
  if (tasks.length === 0) return null;

  return (
    <section className="task-section">
      <div className="task-section-head">
        <span className="task-section-label">{label}</span>
        <span className="task-section-count">{tasks.length}</span>
      </div>
      <div className="task-list">
        {tasks.map((task, i) => (
          <TaskCard
            key={task.id}
            task={task}
            tone={tone}
            onComplete={onComplete}
            onEdit={onEdit}
            index={i}
          />
        ))}
      </div>
    </section>
  );
}
import React from "react";
