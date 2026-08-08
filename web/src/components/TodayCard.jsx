export default function TodayCard({ pendingToday, totalOpen }) {
  const now = new Date();
  return (
    <div className="today-card">
      <div className="today-card-date">
        <span className="day-label">{now.toLocaleDateString([], { weekday: "long" })}</span>
        <span className="date-num">
          {now.toLocaleDateString([], { day: "2-digit" })}
        </span>
        <span className="month-label">{now.toLocaleDateString([], { month: "long" })}</span>
      </div>
      <div className="today-card-stats">
        <div className="stat-row">
          <span className="n">{pendingToday}</span>
          <span className="label">Due today</span>
        </div>
        <div className="stat-row">
          <span className="n">{totalOpen}</span>
          <span className="label">Total open</span>
        </div>
      </div>
    </div>
  );
}
import React from "react";
