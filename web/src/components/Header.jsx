import NameEditor from "./NameEditor.jsx";
import WorkspaceDropdown from "./WorkspaceDropdown.jsx";
import ProfileMenu from "./ProfileMenu.jsx";

export default function Header({
  name,
  onNameChange,
  onSettings,
  onLogout,
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
      <div className="mobile-only"><ProfileMenu compact name={name} onSettings={onSettings} onLogout={onLogout} /></div>
    </div>
  );
}
import React from "react";
