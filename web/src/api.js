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
  return fetch("/api/auth/session", { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 503) return body;
      if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`);
      return body;
    });
}
export function login(key) {
  return apiFetch("/api/auth/login", { method: "POST", body: JSON.stringify({ key }) });
}
export function fetchCapabilities() { return apiFetch("/api/capabilities"); }

export function fetchEmailStatus() { return apiFetch("/api/email/status"); }
export function fetchEmailAccounts() { return apiFetch("/api/email/accounts"); }
export function startOutlookOAuth(displayName = "Outlook", accountId = "") {
  return apiFetch("/api/email/oauth/outlook/start", { method: "POST", body: JSON.stringify({ displayName, ...(accountId ? { accountId } : {}) }) });
}
export function addEmailAccount(values) {
  return apiFetch("/api/email/accounts", { method: "POST", body: JSON.stringify(values) });
}
export function updateEmailAccount(id, values) {
  return apiFetch(`/api/email/accounts/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(values) });
}
export function removeEmailAccount(id) {
  return apiFetch(`/api/email/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
}
export function testEmailAccount(id) {
  return apiFetch(`/api/email/accounts/${encodeURIComponent(id)}/test`, { method: "POST" });
}
export function fetchEmailInbox(accountId = "", limit = 20) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (accountId) params.set("accountId", accountId);
  return apiFetch(`/api/email/inbox?${params}`);
}
export function searchEmail(query, accountIds = [], limit = 20) {
  return apiFetch("/api/email/search", { method: "POST", body: JSON.stringify({ query, accountIds, limit }) });
}
export function fetchEmailMessage(ref) {
  return apiFetch("/api/email/message", { method: "POST", body: JSON.stringify({ ref }) });
}
export function createEmailDraft(values) {
  return apiFetch("/api/email/drafts", { method: "POST", body: JSON.stringify(values) });
}
export function sendEmailDraft(approval) {
  return apiFetch("/api/email/drafts/send", {
    method: "POST",
    headers: { "X-Confirm-Send": "true" },
    body: JSON.stringify({ approval }),
  });
}
export function updateEmailMessageState(state, approval) {
  return apiFetch("/api/email/message-state", { method: "PATCH", body: JSON.stringify({ state, approval }) });
}
export function archiveEmail(approval) {
  return apiFetch("/api/email/archive", { method: "POST", body: JSON.stringify({ approval }) });
}
export function createTaskFromEmail(values) {
  return apiFetch("/api/tasks/from-email", { method: "POST", body: JSON.stringify(values) });
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

export function completeOnboarding(values) {
  return apiFetch("/api/onboarding", { method: "POST", body: JSON.stringify(values) });
}
export function resetOnboarding() { return apiFetch("/api/onboarding/reset", { method: "POST" }); }
export function fetchIntegrations() { return apiFetch("/api/integrations"); }
export function saveIntegration(provider, values) {
  return apiFetch(`/api/integrations/${encodeURIComponent(provider)}`, { method: "POST", body: JSON.stringify(values) });
}
export function removeIntegration(provider) {
  return apiFetch(`/api/integrations/${encodeURIComponent(provider)}`, { method: "DELETE" });
}

export function createWorkspace(name) {
  return apiFetch("/api/workspaces", { method: "POST", body: JSON.stringify({ name }) });
}

export function updateWorkspace(name, values) {
  return apiFetch(`/api/workspaces/${encodeURIComponent(name)}`, { method: "PATCH", body: JSON.stringify(values) });
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

export function fetchMemory(id) {
  return apiFetch(`/api/memories/${encodeURIComponent(id)}`);
}

export function updateMemory(id, content, tags) {
  return apiFetch(`/api/memories/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ content, tags }) });
}

export function appendMemory(id, content) {
  return apiFetch(`/api/memories/${encodeURIComponent(id)}/append`, { method: "POST", body: JSON.stringify({ content }) });
}

export function setMemoryStatus(id, status) {
  return apiFetch(`/api/memories/${encodeURIComponent(id)}/status`, { method: "POST", body: JSON.stringify({ status }) });
}

export function askMemories(question, workspace) {
  return apiFetch("/api/memories/ask", { method: "POST", body: JSON.stringify({ question, workspace: workspace === "All" ? undefined : workspace }) });
}

export function fetchMemoryGraph(seed, limit = 250) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (seed) params.set("seed", seed);
  return apiFetch(`/api/memories/graph?${params}`);
}

export function fetchMemoryStats() { return apiFetch("/api/memories/stats"); }
export function fetchMemoriesHealth() { return apiFetch("/api/memories/health"); }
export function fetchMemoryConfig() { return apiFetch("/api/memories/config"); }
export function saveMemoryConfig(patch) { return apiFetch("/api/memories/config", { method: "PATCH", body: JSON.stringify(patch) }); }

export async function downloadMemoriesExport() {
  const payload = await apiFetch("/api/memories/export");
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `nudge-memories-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function importMemoriesBackup(payload, offset = 0, edgeOffset = 0, limit = 50) {
  const params = new URLSearchParams({ offset: String(offset), edgeOffset: String(edgeOffset), limit: String(limit) });
  return apiFetch(`/api/memories/import?${params}`, { method: "POST", body: JSON.stringify(payload) });
}

export function fetchMemoryReindexStatus() { return apiFetch("/api/memories/reindex"); }
export function reindexMemoriesBatch() { return apiFetch("/api/memories/reindex", { method: "POST" }); }
