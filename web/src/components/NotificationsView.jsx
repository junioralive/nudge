import { Bell, BellRing, Clock, CheckCheck } from "lucide-react";

function formatDue(dueAt) {
  const d = new Date(dueAt.includes("T") ? dueAt : dueAt.replace(" ", "T"));
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function NotificationsView({
  tasks, pushStatus, onEnableNotifications, onDisableNotifications, onTestNotification, onRetryNotifications,
}) {
  const pushEnabled = pushStatus.state === "enabled";
  const current = pushStatus.server?.current;
  const stateLabels = {
    loading: "Checking notifications",
    unsupported: "Notifications unsupported",
    "install-required": "Install Nudge first",
    blocked: "Notifications blocked",
    disconnected: "Notifications are off",
    enabled: "Notifications are on",
    error: "Notification check failed",
  };
  const upcoming = tasks
    .filter((t) => !t.done_at && t.due_at && !t.notified_at)
    .sort((a, b) => a.due_at.localeCompare(b.due_at));

  const sent = tasks
    .filter((t) => t.notified_at)
    .sort((a, b) => b.notified_at.localeCompare(a.notified_at))
    .slice(0, 10);

  return (
    <div className="notif-view">
      <div className={`notif-status-card ${pushEnabled ? "on" : ""}`}>
        <div className="notif-status-icon">{pushEnabled ? <BellRing size={20} /> : <Bell size={20} />}</div>
        <div className="notif-status-text">
          <strong>{stateLabels[pushStatus.state] || "Notifications"}</strong>
          <span>{pushStatus.detail}</span>
          {pushEnabled && <small>{current?.device_name || pushStatus.deviceName}{current?.last_success_at ? ` · Last delivered ${formatDue(current.last_success_at)}` : " · Ready for first delivery"}</small>}
        </div>
        {["disconnected", "error"].includes(pushStatus.state) && (
          <button className="notif-enable-btn" onClick={onEnableNotifications}>
            {pushStatus.state === "error" ? "Retry" : "Enable"}
          </button>
        )}
      </div>

      {pushEnabled && <div className="notif-controls">
        <button onClick={onTestNotification}>Send test</button>
        {(pushStatus.server?.failedDeliveries || 0) > 0 && <button onClick={onRetryNotifications}>Retry failed ({pushStatus.server.failedDeliveries})</button>}
        <button className="quiet" onClick={onDisableNotifications}>Disable this device</button>
      </div>}

      {pushStatus.state === "blocked" && <div className="notif-help">Allow notifications for nudge.junioralive.in in your browser’s site settings, then reload Nudge.</div>}
      {pushStatus.state === "install-required" && <div className="notif-help">In Safari, tap Share → Add to Home Screen. Open the installed Nudge app and enable notifications there.</div>}

      <section className="task-section">
        <div className="task-section-head">
          <span className="task-section-label">Upcoming nudges</span>
          <span className="task-section-count">{upcoming.length}</span>
        </div>
        {upcoming.length === 0 ? (
          <div className="empty">No pending reminders. Add a due time on a task to get nudged.</div>
        ) : (
          <div className="notif-list">
            {upcoming.map((t) => (
              <div key={t.id} className="notif-row">
                <span className="notif-row-icon">
                  <Clock size={15} />
                </span>
                <div className="notif-row-text">
                  <strong>{t.text}</strong>
                  <span>Nudging you {formatDue(t.due_at)}</span>
                </div>
                <span className="notif-row-ws">{t.workspace || "Personal"}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="task-section">
        <div className="task-section-head">
          <span className="task-section-label">Already sent</span>
          <span className="task-section-count">{sent.length}</span>
        </div>
        {sent.length === 0 ? (
          <div className="empty">Nothing sent yet.</div>
        ) : (
          <div className="notif-list">
            {sent.map((t) => (
              <div key={t.id} className="notif-row sent">
                <span className="notif-row-icon done">
                  <CheckCheck size={15} />
                </span>
                <div className="notif-row-text">
                  <strong>{t.text}</strong>
                  <span>Sent {formatDue(t.notified_at)}</span>
                </div>
                <span className="notif-row-ws">{t.workspace || "Personal"}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
import React from "react";
