const NAME_KEY = "nudge:name";
const WORKSPACES_KEY = "nudge:workspaces";
const ACTIVE_WORKSPACE_KEY = "nudge:activeWorkspace";

const DEFAULT_WORKSPACES = ["Personal", "Work", "Startup"];

export function getName() {
  return localStorage.getItem(NAME_KEY) || "Junior";
}

export function setName(name) {
  localStorage.setItem(NAME_KEY, name);
}

export function getWorkspaces() {
  try {
    const stored = JSON.parse(localStorage.getItem(WORKSPACES_KEY));
    if (Array.isArray(stored) && stored.length) return stored;
  } catch {
    // fall through to defaults
  }
  return DEFAULT_WORKSPACES;
}

export function addWorkspace(name) {
  const list = getWorkspaces();
  if (!list.includes(name)) {
    const next = [...list, name];
    localStorage.setItem(WORKSPACES_KEY, JSON.stringify(next));
    return next;
  }
  return list;
}

export function getActiveWorkspace() {
  return localStorage.getItem(ACTIVE_WORKSPACE_KEY) || "All";
}

export function setActiveWorkspace(name) {
  localStorage.setItem(ACTIVE_WORKSPACE_KEY, name);
}
