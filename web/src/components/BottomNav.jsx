import { Bell, Brain, Home, Mail, Plus, Puzzle, X } from "lucide-react";
import { useEffect, useState } from "react";
import Logo from "./Logo.jsx";

export default function BottomNav({ capabilities = {}, onAdd, addOpen, view, onNavigate, onTalk, voiceOpen }) {
  const [pluginsOpen, setPluginsOpen] = useState(false);

  useEffect(() => {
    if (view !== "memories" && view !== "email") setPluginsOpen(false);
  }, [view]);

  function navigate(target) {
    setPluginsOpen(false);
    onNavigate(target);
  }

  const talkButton = <button
    className={`talk ${voiceOpen ? "active" : ""}`}
    onClick={onTalk}
    aria-label="Talk to Nudge"
    disabled={!capabilities.gemini}
  >
    <Logo size={18} color={voiceOpen ? "#E787FF" : "#FFFFFF"} />
  </button>;

  return (
    <div className={`bottom-nav-wrap ${pluginsOpen ? "plugins-open" : ""}`}>
      <nav className="bottom-nav" aria-label={pluginsOpen ? "Nudge plugins" : "Primary navigation"}>
        {pluginsOpen ? <>
          {capabilities.secondBrain && <button className={view === "memories" ? "active" : ""} onClick={() => navigate("memories")} aria-label="Memories"><Brain size={18} /></button>}
          {talkButton}
          {capabilities.email && <button className={view === "email" ? "active" : ""} onClick={() => navigate("email")} aria-label="Email"><Mail size={18} /></button>}
        </> : <>
          <button className={view === "home" ? "active" : ""} onClick={() => navigate("home")} aria-label="Home"><Home size={19} /></button>
          <button className={view === "notifications" ? "active" : ""} onClick={() => navigate("notifications")} aria-label="Notifications"><Bell size={19} /></button>
          {talkButton}
          <button className="add-btn" onClick={onAdd} aria-label={addOpen ? "Close add task" : "Add task"}>{addOpen ? <X size={19} /> : <Plus size={19} />}</button>
        </>}
      </nav>
      <button
        type="button"
        className={`plugins-toggle ${pluginsOpen ? "open" : ""}`}
        onClick={() => setPluginsOpen((open) => !open)}
        aria-label={pluginsOpen ? "Close plugins" : "Open plugins"}
        aria-expanded={pluginsOpen}
      >
        {pluginsOpen ? <X size={19} /> : <Puzzle size={18} />}
      </button>
    </div>
  );
}
