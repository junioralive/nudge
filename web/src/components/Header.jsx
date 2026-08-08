import { Bell, BellRing } from "lucide-react";
import NameEditor from "./NameEditor.jsx";
import WorkspaceDropdown from "./WorkspaceDropdown.jsx";

export default function Header({
  name,
  onNameChange,
  pushEnabled,
  onEnableNotifications,
  workspaces,
  activeWorkspace,
  onSelectWorkspace,
  onAddWorkspace,
  onDeleteWorkspace,
}) {
  return (
    <div className="header">
      <div>
        <p className="greeting-eyebrow">Hey there</p>
        <h1>
          What's on your{" "}
          <WorkspaceDropdown
            workspaces={workspaces}
            active={activeWorkspace}
            onSelect={onSelectWorkspace}
            onAdd={onAddWorkspace}
            onDelete={onDeleteWorkspace}
          />
          , <NameEditor name={name} onChange={onNameChange} />?
        </h1>
      </div>
      <button
        className={`bell mobile-only ${pushEnabled ? "enabled" : ""}`}
        onClick={onEnableNotifications}
        title={pushEnabled ? "Notifications on" : "Enable notifications"}
        aria-label="Enable notifications"
      >
        {pushEnabled ? <BellRing size={19} /> : <Bell size={19} />}
      </button>
    </div>
  );
}
import React from "react";
