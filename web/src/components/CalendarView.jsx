import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Link2, MapPin, Plus, RefreshCw, Trash2 } from "lucide-react";
import { buildMonthGrid, dateKey, taskDateKey, WEEKDAY_LABELS } from "../lib/calendar.js";
import { addCalendarSource, fetchCalendarEvents, fetchCalendarSources, removeCalendarSource, syncCalendarSource } from "../api.js";
import TaskCard from "./TaskCard.jsx";

const MONTH_LABEL = { month: "long", year: "numeric" };
const CARD_TONES = ["tone-purple", "tone-amber", "tone-mint", "tone-neutral"];

export default function CalendarView({ tasks, workspaces, workspaceColors = {}, onComplete }) {
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(dateKey(today));
  const [tab, setTab] = useState("calendar");
  const [events, setEvents] = useState([]);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ provider: "google", url: "", name: "", color: "#7FB2FF" });

  const todayKey = dateKey(today);
  const weeks = useMemo(() => buildMonthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);
  const range = useMemo(() => {
    const days = weeks.flat();
    return { from: days[0].toISOString(), to: new Date(days.at(-1).getTime() + 86_400_000).toISOString() };
  }, [weeks]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([fetchCalendarSources(), fetchCalendarEvents(range.from, range.to)])
      .then(([sourceResult, eventResult]) => {
        if (!live) return;
        setSources(sourceResult.sources || []);
        setEvents(eventResult.events || []);
        setStatus("");
      })
      .catch((error) => live && setStatus(error.message))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [range.from, range.to]);

  const tasksByDay = useMemo(() => {
    const map = {};
    for (const task of tasks) {
      const key = taskDateKey(task);
      if (!key) continue;
      (map[key] ||= []).push(task);
    }
    return map;
  }, [tasks]);

  const eventsByDay = useMemo(() => {
    const map = {};
    for (const event of events) {
      const key = dateKey(new Date(event.starts_at));
      (map[key] ||= []).push(event);
    }
    return map;
  }, [events]);

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
  const selectedEvents = (eventsByDay[selected] || []).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const selectedLabel = new Date(`${selected}T00:00:00`).toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  async function connectCalendar(event) {
    event.preventDefault();
    setStatus("Connecting calendar…");
    try {
      const source = await addCalendarSource(form);
      setSources((current) => [...current, source]);
      setForm({ provider: "google", url: "", name: "", color: "#7FB2FF" });
      setAdding(false);
      const result = await fetchCalendarEvents(range.from, range.to, false);
      setEvents(result.events || []);
      setStatus("Calendar connected.");
    } catch (error) { setStatus(error.message); }
  }

  async function refreshSource(id) {
    setStatus("Refreshing calendar…");
    try {
      await syncCalendarSource(id);
      const [sourceResult, eventResult] = await Promise.all([fetchCalendarSources(), fetchCalendarEvents(range.from, range.to, false)]);
      setSources(sourceResult.sources || []);
      setEvents(eventResult.events || []);
      setStatus("Calendar is up to date.");
    } catch (error) { setStatus(error.message); }
  }

  async function disconnectSource(id) {
    if (!window.confirm("Disconnect this calendar? Its cached events will be removed from Nudge.")) return;
    await removeCalendarSource(id);
    setSources((current) => current.filter((source) => source.id !== id));
    setEvents((current) => current.filter((event) => event.source_id !== id));
  }

  if (tab === "sources") return (
    <div className="calendar-view">
      <div className="calendar-section-toolbar">
        <nav className="email-section-nav calendar-section-nav" aria-label="Calendar sections"><button type="button" onClick={() => setTab("calendar")}><CalendarDays size={16} />Calendar</button><button type="button" className="active"><Link2 size={16} />Sources<span>{sources.length}</span></button></nav>
        <button type="button" className={`calendar-add-source ${adding ? "active" : ""}`} onClick={() => setAdding((value) => !value)}><Plus size={17} />{adding ? "Close" : "Add calendar"}</button>
      </div>
      {adding && <form className="calendar-source-form" onSubmit={connectCalendar}>
        <div><label>Provider</label><select value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value })}><option value="google">Google Calendar</option><option value="outlook">Outlook Calendar</option><option value="icloud">iCloud Calendar</option></select></div>
        <div><label>Private iCal link</label><input type="url" required value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder={form.provider === "icloud" ? "webcal://p…-caldav.icloud.com/published/…" : "https://…/calendar.ics"} /></div>
        <div><label>Name <span>optional</span></label><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Work calendar" /></div>
        <div className="calendar-source-help"><Link2 size={16} /><span>Use the private/secret iCal subscription link. Nudge encrypts it and connects read-only.</span></div>
        <div className="calendar-source-actions"><button type="button" onClick={() => setAdding(false)}>Cancel</button><button className="primary-btn" type="submit">Connect</button></div>
      </form>}
      {status && <p className="calendar-status">{status}</p>}
      <div className="calendar-source-list">
        {sources.length === 0 && !adding ? <div className="calendar-empty-source"><CalendarDays size={26} /><h3>No calendars connected</h3><p>Add a private Google, Outlook, or iCloud iCal link. Your provider remains the source of truth.</p></div> : sources.map((source) => <div className="calendar-source-card" key={source.id}>
          <span className="calendar-source-color" style={{ background: source.color }} />
          <div><strong>{source.name}</strong><span>{source.provider} · {source.last_synced_at ? `Updated ${new Date(source.last_synced_at).toLocaleString()}` : "Not synced"}</span>{source.last_sync_error && <em>{source.last_sync_error}</em>}</div>
          <button onClick={() => refreshSource(source.id)} aria-label="Refresh calendar"><RefreshCw size={17} /></button>
          <button className="danger-icon" onClick={() => disconnectSource(source.id)} aria-label="Disconnect calendar"><Trash2 size={17} /></button>
        </div>)}
      </div>
    </div>
  );

  return (
    <div className="calendar-view">
      <div className="calendar-section-toolbar"><nav className="email-section-nav calendar-section-nav" aria-label="Calendar sections"><button type="button" className="active"><CalendarDays size={16} />Calendar</button><button type="button" onClick={() => setTab("sources")}><Link2 size={16} />Sources<span>{sources.length}</span></button></nav>{loading && <span className="calendar-syncing"><RefreshCw size={14} /> Syncing</span>}</div>
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
          const dayEvents = eventsByDay[key] || [];
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
                      className="calendar-dot"
                      style={{ backgroundColor: workspaceColors[t.workspace] || "#E787FF" }}
                    />
                  ))}
                  {dayTasks.length > 3 && <span className="calendar-dot-more">+{dayTasks.length - 3}</span>}
                </span>
              )}
              {dayEvents.length > 0 && <span className="calendar-event-bars">{dayEvents.slice(0, 2).map((event) => <span key={`${event.source_id}-${event.id}`} style={{ background: event.color }} />)}{dayEvents.length > 2 && <small>+{dayEvents.length - 2}</small>}</span>}
            </button>
          );
        })}
      </div>

      <div className="calendar-day-panel">
        <div className="task-section-head">
          <span className="task-section-label">{selectedLabel}</span>
          <span className="task-section-count">{selectedTasks.length + selectedEvents.length}</span>
        </div>
        {selectedEvents.length > 0 && <div className="calendar-event-list">{selectedEvents.map((event) => <article className="calendar-event-card" key={`${event.source_id}-${event.id}`} style={{ "--event-color": event.color }}>
          <div className="calendar-event-time"><Clock3 size={15} />{event.all_day ? "All day" : new Date(event.starts_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
          <div><h3>{event.title}</h3><p>{event.calendar_name}{event.location ? <><span> · </span><MapPin size={13} /> {event.location}</> : null}</p>{event.description && <details><summary>Details</summary><div>{event.description}</div></details>}</div>
        </article>)}</div>}
        {selectedTasks.length > 0 && (
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
        {selectedTasks.length === 0 && selectedEvents.length === 0 && <div className="empty">Nothing scheduled this day.</div>}
        {status && <p className="calendar-status">{status}</p>}
      </div>
    </div>
  );
}
