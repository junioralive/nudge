import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buildMonthGrid, dateKey, taskDateKey, WEEKDAY_LABELS } from "../lib/calendar.js";
import TaskCard from "./TaskCard.jsx";

const MONTH_LABEL = { month: "long", year: "numeric" };
const DOT_TONES = ["dot-purple", "dot-amber", "dot-mint", "dot-blue", "dot-rose"];
const CARD_TONES = ["tone-purple", "tone-amber", "tone-mint", "tone-neutral"];

export default function CalendarView({ tasks, workspaces, onComplete }) {
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(dateKey(today));

  const todayKey = dateKey(today);
  const weeks = useMemo(() => buildMonthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);

  const tasksByDay = useMemo(() => {
    const map = {};
    for (const task of tasks) {
      const key = taskDateKey(task);
      if (!key) continue;
      (map[key] ||= []).push(task);
    }
    return map;
  }, [tasks]);

  const workspaceTone = useMemo(() => {
    const tones = {};
    workspaces.forEach((ws, i) => {
      tones[ws] = DOT_TONES[i % DOT_TONES.length];
    });
    return tones;
  }, [workspaces]);

  function shiftMonth(delta) {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  }

  function goToday() {
    setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelected(todayKey);
  }

  const selectedTasks = (tasksByDay[selected] || []).sort((a, b) =>
    (a.due_at || "").localeCompare(b.due_at || ""),
  );
  const selectedLabel = new Date(`${selected}T00:00:00`).toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="calendar-view">
      <div className="calendar-toolbar">
        <div className="calendar-nav">
          <button onClick={() => shiftMonth(-1)} aria-label="Previous month">
            <ChevronLeft size={18} />
          </button>
          <span className="calendar-month-label">{cursor.toLocaleDateString([], MONTH_LABEL)}</span>
          <button onClick={() => shiftMonth(1)} aria-label="Next month">
            <ChevronRight size={18} />
          </button>
        </div>
        <button className="icon-pill" onClick={goToday}>
          Today
        </button>
      </div>

      <div className="calendar-grid">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="calendar-weekday">
            {label}
          </div>
        ))}

        {weeks.flat().map((date) => {
          const key = dateKey(date);
          const inMonth = date.getMonth() === cursor.getMonth();
          const dayTasks = tasksByDay[key] || [];
          const isToday = key === todayKey;
          const isSelected = key === selected;

          return (
            <button
              key={key}
              className={`calendar-cell ${inMonth ? "" : "outside"} ${isToday ? "today" : ""} ${isSelected ? "selected" : ""}`}
              onClick={() => setSelected(key)}
            >
              <span className="calendar-day-num">{date.getDate()}</span>
              {dayTasks.length > 0 && (
                <span className="calendar-dots">
                  {dayTasks.slice(0, 3).map((t) => (
                    <span
                      key={t.id}
                      className={`calendar-dot ${workspaceTone[t.workspace] || "dot-purple"}`}
                    />
                  ))}
                  {dayTasks.length > 3 && <span className="calendar-dot-more">+{dayTasks.length - 3}</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="calendar-day-panel">
        <div className="task-section-head">
          <span className="task-section-label">{selectedLabel}</span>
          <span className="task-section-count">{selectedTasks.length}</span>
        </div>
        {selectedTasks.length === 0 ? (
          <div className="empty">Nothing due this day.</div>
        ) : (
          <div className="task-list">
            {selectedTasks.map((task, i) => (
              <TaskCard
                key={task.id}
                task={task}
                tone={CARD_TONES[i % CARD_TONES.length]}
                onComplete={onComplete}
                index={i}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
