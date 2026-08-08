import TaskCard from "./TaskCard.jsx";

function dateKey(value) {
  return new Date(value).toLocaleDateString("en-CA");
}

function dateLabel(value) {
  return new Intl.DateTimeFormat([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export default function CompletedTaskList({ tasks, onEdit, onDelete }) {
  if (tasks.length === 0) return <div className="empty">No completed tasks match this view.</div>;

  const groups = new Map();
  for (const task of tasks) {
    const key = dateKey(task.done_at);
    if (!groups.has(key)) groups.set(key, { value: task.done_at, tasks: [] });
    groups.get(key).tasks.push(task);
  }

  return (
    <div className="completed-sections">
      {[...groups.values()].map((group) => (
        <section className="completed-section" key={dateKey(group.value)}>
          <div className="completed-section-head">
            <span>{dateLabel(group.value)}</span>
            <span>{group.tasks.length}</span>
          </div>
          <div className="task-list">
            {group.tasks.map((task, index) => (
              <TaskCard key={task.id} task={task} tone="tone-neutral" onEdit={onEdit} onDelete={onDelete} index={index} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
