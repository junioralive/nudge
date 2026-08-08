function parseDue(dueAt) {
  if (!dueAt) return null;
  return new Date(dueAt.includes("T") ? dueAt : dueAt.replace(" ", "T"));
}

export function groupTasks(tasks) {
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const groups = {
    overdue: [],
    today: [],
    upcoming: [],
    someday: [],
  };

  for (const task of tasks) {
    const due = parseDue(task.due_at);
    if (!due) groups.someday.push(task);
    else if (due < now) groups.overdue.push(task);
    else if (due <= endOfToday) groups.today.push(task);
    else groups.upcoming.push(task);
  }

  return groups;
}

export const GROUP_META = [
  { key: "overdue", label: "Overdue", tone: "tone-amber" },
  { key: "today", label: "Today", tone: "tone-purple" },
  { key: "upcoming", label: "Upcoming", tone: "tone-mint" },
  { key: "someday", label: "Someday", tone: "tone-neutral" },
];
