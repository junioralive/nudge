async function apiFetch(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(body?.error || `Request failed (${response.status})`);
    error.status = response.status;
    if (response.status === 401 && !path.startsWith("/api/auth/")) {
      window.dispatchEvent(new Event("nudge:unauthorized"));
    }
    throw error;
  }
  return body;
}

export function getSession() {
  return apiFetch("/api/auth/session");
}
export function fetchCapabilities() { return apiFetch("/api/capabilities"); }

export function login(key) {
  return apiFetch("/api/auth/login", { method: "POST", body: JSON.stringify({ key }) });
}

export function logout() {
  return apiFetch("/api/auth/logout", { method: "POST" });
}

export function fetchBootstrap() {
  return apiFetch("/api/bootstrap");
}

export function bootstrapFromLocal(name, workspaces) {
  return apiFetch("/api/bootstrap", { method: "POST", body: JSON.stringify({ name, workspaces }) });
}

export function updateProfile(values) {
  return apiFetch("/api/profile", { method: "PUT", body: JSON.stringify(values) });
}

export function createWorkspace(name) {
  return apiFetch("/api/workspaces", { method: "POST", body: JSON.stringify({ name }) });
}

export function deleteWorkspace(name) {
  return apiFetch(`/api/workspaces/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export function fetchTasks() {
  return apiFetch("/api/tasks");
}

export function createTask(text, dueAt, workspace, extra = {}) {
  const due_at = dueAt ? new Date(dueAt).toISOString() : null;
  return apiFetch("/api/tasks", {
    method: "POST",
    body: JSON.stringify({ text, due_at, workspace, ...extra }),
  });
}

export function updateTask(id, values) {
  const body = { ...values, due_at: values.due_at ? new Date(values.due_at).toISOString() : values.due_at === "" ? null : values.due_at };
  return apiFetch(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function completeTask(id) {
  return apiFetch(`/api/tasks/${id}/done`, { method: "POST" });
}

export function deleteTask(id) {
  return apiFetch(`/api/tasks/${id}`, { method: "DELETE" });
}

export async function getVapidPublicKey() {
  const { key } = await apiFetch("/api/vapid-public-key");
  return key;
}

export function fetchPushStatus(deviceId) {
  return apiFetch(`/api/push/status?device_id=${encodeURIComponent(deviceId)}`);
}

export function saveSubscription(deviceId, deviceName, subscription) {
  return apiFetch("/api/push/subscriptions", {
    method: "POST",
    body: JSON.stringify({ device_id: deviceId, device_name: deviceName, subscription }),
  });
}

export function disablePushDevice(deviceId) {
  return apiFetch(`/api/push/subscriptions/${encodeURIComponent(deviceId)}`, { method: "DELETE" });
}

export function sendTestPush(deviceId) {
  return apiFetch("/api/push/test", { method: "POST", body: JSON.stringify({ device_id: deviceId }) });
}

export function retryPushDeliveries() {
  return apiFetch("/api/push/retry", { method: "POST" });
}

export function fetchRecentMemories(workspace, limit = 20) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (workspace && workspace !== "All") params.set("workspace", workspace);
  return apiFetch(`/api/memories/recent?${params}`);
}

export function searchMemories(query, workspace, limit = 10) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (workspace && workspace !== "All") params.set("workspace", workspace);
  return apiFetch(`/api/memories/search?${params}`);
}

export function createMemory(content, workspace, tags = []) {
  return apiFetch("/api/memories", {
    method: "POST",
    body: JSON.stringify({ content, workspace: workspace === "All" ? undefined : workspace, tags }),
  });
}

export function deleteMemory(id) {
  return apiFetch(`/api/memories/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "X-Confirm-Delete": "true" },
  });
}
