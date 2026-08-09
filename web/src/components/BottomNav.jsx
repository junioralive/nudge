import { Home, Plus, X, Bell, Brain, CalendarDays, Mic } from "lucide-react";
import Logo from "./Logo.jsx";

export default function BottomNav({ pushEnabled, capabilities = {}, onAdd, addOpen, view, onNavigate, onTalk, voiceOpen }) {
  return (
    <div className="bottom-nav-wrap">
      <div className="bottom-nav">
        <button className={view === "home" ? "active" : ""} onClick={() => onNavigate("home")} aria-label="Home">
          <Home size={19} />
        </button>
        <button
          className={`${pushEnabled ? "active" : ""} ${view === "notifications" ? "active" : ""}`}
          onClick={() => onNavigate("notifications")}
          aria-label="Notifications"
        >
          <Bell size={19} />
        </button>

        {capabilities.gemini && <button className={`talk ${voiceOpen ? "active" : ""}`} onClick={onTalk} aria-label="Talk to Nudge">
          {voiceOpen ? <Mic size={19} /> : <Logo size={18} color="#FFFFFF" />}
        </button>}

        <button className="add-btn" onClick={onAdd} aria-label={addOpen ? "Close add task" : "Add task"}>
          {addOpen ? <X size={19} /> : <Plus size={19} />}
        </button>
        <button
          className={view === "calendar" ? "active" : ""}
          onClick={() => onNavigate("calendar")}
          aria-label="Calendar"
        >
          <CalendarDays size={18} />
        </button>
        {capabilities.secondBrain && <button
          className={view === "memories" ? "active" : ""}
          onClick={() => onNavigate("memories")}
          aria-label="Memories"
        >
          <Brain size={18} />
        </button>}
      </div>
    </div>
  );
}
import React from "react";
