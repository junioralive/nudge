import TaskSection from "./TaskSection.jsx";
import { groupTasks, GROUP_META } from "../lib/group.js";

export default function TaskList({ tasks, onComplete, onEdit }) {
  if (tasks.length === 0) {
    return <div className="empty">Nothing here. Add something above and it'll show up.</div>;
  }

  const groups = groupTasks(tasks);

  return (
    <div className="task-sections">
      {GROUP_META.map(({ key, label, tone }) => (
        <TaskSection
          key={key}
          label={label}
          tasks={groups[key]}
          tone={tone}
          onComplete={onComplete}
          onEdit={onEdit}
        />
      ))}
    </div>
  );
}
import React from "react";
