import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, Plus, Volume2, X } from "lucide-react";
import {
  completeTask,
  createTask,
  createWorkspace,
  deleteTask,
  deleteWorkspace,
  fetchBootstrap,
  fetchCapabilities,
  fetchTasks,
  getSession,
  login,
  logout,
  updateProfile,
  completeOnboarding,
  resetOnboarding,
  updateTask,
  updateWorkspace,
} from "./api.js";
import { disablePushNotifications, enablePushNotifications, reconcilePushNotifications, sendPushTest } from "./push.js";
import { retryPushDeliveries } from "./api.js";
import {
  getName,
  setName as saveName,
  getWorkspaces,
  getActiveWorkspace,
  setActiveWorkspace as saveActiveWorkspace,
} from "./lib/storage.js";
import Header from "./components/Header.jsx";
import SearchBar from "./components/SearchBar.jsx";
import Tabs from "./components/Tabs.jsx";
import TodayCard from "./components/TodayCard.jsx";
import AddTaskForm from "./components/AddTaskForm.jsx";
import AgendaHeader from "./components/AgendaHeader.jsx";
import TaskList from "./components/TaskList.jsx";
import CompletedTaskList from "./components/CompletedTaskList.jsx";
import BottomNav from "./components/BottomNav.jsx";
import Sidebar from "./components/Sidebar.jsx";
import WorkspaceSwitcher from "./components/WorkspaceSwitcher.jsx";
import CalendarView from "./components/CalendarView.jsx";
import NotificationsView from "./components/NotificationsView.jsx";
import LoginScreen from "./components/LoginScreen.jsx";
import TaskEditor from "./components/TaskEditor.jsx";
import SettingsView from "./components/SettingsView.jsx";
import WorkspaceDialog from "./components/WorkspaceDialog.jsx";
import EmailDraftDialog from "./components/EmailDraftDialog.jsx";
import { PlaybackQueue } from "./voice/playbackQueue.ts";
import { VoiceConnectionManager } from "./voice/connectionManager.ts";
import { ASSISTANT_VOICES } from "./voice/voiceCatalog.js";

const VoicePanel = lazy(() => import("./components/VoicePanel.jsx"));
const MemoriesView = lazy(() => import("./components/MemoriesView.jsx"));
const EmailView = lazy(() => import("./components/EmailView.jsx"));

function isToday(dueAt) {
  if (!dueAt) return false;
  return new Date(dueAt).toDateString() === new Date().toDateString();
}

export default function App() {
  const [authState, setAuthState] = useState(null);

  useEffect(() => {
    getSession().then((session) => setAuthState(session)).catch(() => setAuthState({ authenticated: false, authMode: null }));
    const lock = () => setAuthState((current) => ({ authenticated: false, authMode: current?.authMode || null }));
    window.addEventListener("nudge:unauthorized", lock);
    return () => window.removeEventListener("nudge:unauthorized", lock);
  }, []);

  useEffect(() => {
    const play = (event) => {
      if (event.data?.type !== "nudge:push-received" || localStorage.getItem("nudge-sound") === "off") return;
      const audio = new Audio("/sounds/nudge.mp3");
      audio.volume = 0.55;
      audio.play().catch(() => {});
    };
    navigator.serviceWorker?.addEventListener("message", play);
    return () => navigator.serviceWorker?.removeEventListener("message", play);
  }, []);

  useEffect(() => {
    if (authState !== null) {
      const splash = document.getElementById("nudge-splash");
      if (splash) { splash.classList.add("done"); window.setTimeout(() => splash.remove(), 220); }
    }
  }, [authState]);

  if (authState === null) return <div className="app-loading">Loading Nudge…</div>;
  if (!authState.authenticated) {
    return <LoginScreen authMode={authState.authMode} configurationError={authState.error} onLogin={async (key) => {
      const result = await login(key);
      setAuthState(result);
    }} />;
  }
  return <NudgeApp authMode={authState.authMode} onLogout={async () => {
    const result = await logout();
    setAuthState({ authenticated: false, authMode: authState.authMode });
    if (result?.logoutUrl) window.location.assign(result.logoutUrl);
  }} />;
}

function NudgeApp({ authMode, onLogout }) {
  const [tasks, setTasks] = useState([]);
  const [pushStatus, setPushStatus] = useState({ state: "loading", detail: "Checking this device…" });
  const [capabilities, setCapabilities] = useState({ gemini: true, secondBrain: true, email: false, outlook: false });
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("today");
  const [sortByDue, setSortByDue] = useState(true);
  const [name, setNameState] = useState(getName());
  const [profile, setProfile] = useState({ name: getName(), timezone: "Asia/Kolkata", assistantGender: "she", assistantVoice: "Zephyr" });
  const [workspaces, setWorkspaces] = useState(getWorkspaces());
  const [workspaceColors, setWorkspaceColors] = useState({});
  const [workspaceDialog, setWorkspaceDialog] = useState(null);
  const [activeWorkspace, setActiveWorkspaceState] = useState(getActiveWorkspace());
  const [showAddForm, setShowAddForm] = useState(false);
  const [view, setView] = useState("home");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [editingTask, setEditingTask] = useState(null);
  const [emailDraft, setEmailDraft] = useState(null);
  const [onboardingRequired, setOnboardingRequired] = useState(false);
  const addInputRef = useRef(null);

  async function refresh() {
    try {
      setTasks(await fetchTasks());
      setLoadError("");
    } catch (error) {
      setLoadError(error.message);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        let bootstrap = await fetchBootstrap();
        setCapabilities(await fetchCapabilities());
        if (!bootstrap.initialized) bootstrap = { ...bootstrap, onboarding_required: true, name: "", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", workspaces: ["Personal", "Work", "Startup"], workspace_colors: {} };
        setOnboardingRequired(Boolean(bootstrap.onboarding_required));
        setNameState(bootstrap.name);
        setProfile({
          name: bootstrap.name,
          timezone: bootstrap.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          assistantGender: bootstrap.assistant_gender || "she",
          assistantVoice: bootstrap.assistant_voice || "Zephyr",
        });
        saveName(bootstrap.name);
        setWorkspaces(bootstrap.workspaces);
        setWorkspaceColors(bootstrap.workspace_colors || {});
        if (activeWorkspace !== "All" && !bootstrap.workspaces.includes(activeWorkspace)) {
          setActiveWorkspaceState("All");
          saveActiveWorkspace("All");
        }
        await refresh();
        setPushStatus(await reconcilePushNotifications());
      } catch (error) {
        setLoadError(error.message);
      }
    })();
  }, []);

  useEffect(() => {
    const openDraft = (event) => event.detail && setEmailDraft(event.detail);
    window.addEventListener("nudge:email-draft", openDraft);
    return () => window.removeEventListener("nudge:email-draft", openDraft);
  }, []);

  useEffect(() => {
    if (showAddForm) addInputRef.current?.focus();
  }, [showAddForm]);

  useEffect(() => {
    function focusTask(taskId) {
      if (!taskId) return;
      setView("home");
      setTab("all");
      setQuery("");
      setActiveWorkspaceState("All");
      setTimeout(() => {
        const card = document.getElementById(`task-${taskId}`);
        card?.scrollIntoView({ behavior: "smooth", block: "center" });
        card?.classList.add("notification-highlight");
        setTimeout(() => card?.classList.remove("notification-highlight"), 3000);
      }, 100);
    }
    const initialTask = Number(new URLSearchParams(location.search).get("task"));
    if (initialTask) focusTask(initialTask);
    const onMessage = (event) => event.data?.type === "nudge:notification-open" && focusTask(Number(event.data.taskId));
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, []);

  function handleNameChange(next) {
    setNameState(next);
    setProfile((current) => ({ ...current, name: next }));
    saveName(next);
    updateProfile({ name: next }).catch((error) => setLoadError(error.message));
  }

  async function handleSettingsSave(next) {
    const values = {
      name: next.name.trim(),
      timezone: next.timezone,
      assistant_gender: next.assistantGender,
      assistant_voice: next.assistantVoice,
    };
    await updateProfile(values);
    setProfile({ ...next, name: values.name });
    setNameState(values.name);
    saveName(values.name);
  }

  function handleSelectWorkspace(workspace) {
    setActiveWorkspaceState(workspace);
    saveActiveWorkspace(workspace);
  }

  async function handleAddWorkspace(workspace) {
    try {
      const result = await createWorkspace(workspace);
      setWorkspaces(result.workspaces);
      setWorkspaceColors(result.workspace_colors || {});
    } catch (error) {
      setLoadError(error.message);
    }
  }

  async function handleDeleteWorkspace(workspace) {
    if (workspace === "Personal") return;
    const result = await deleteWorkspace(workspace);
    setWorkspaces(result.workspaces);
    setWorkspaceColors(result.workspace_colors || {});
    if (activeWorkspace === workspace) handleSelectWorkspace("All");
    await refresh();
  }

  async function handleUpdateWorkspace(workspace, values) {
    const result = await updateWorkspace(workspace, values);
    setWorkspaces(result.workspaces);
    setWorkspaceColors(result.workspace_colors || {});
    if (values.name && activeWorkspace === workspace) handleSelectWorkspace(values.name);
    await refresh();
  }

  async function handleWorkspaceDialogConfirm(values) {
    if (!workspaceDialog) return;
    if (workspaceDialog.mode === "delete") return handleDeleteWorkspace(workspaceDialog.workspace);
    return handleUpdateWorkspace(workspaceDialog.workspace, values);
  }

  async function handleAdd(text, dueAt, workspace, extra = {}) {
    try {
      await createTask(text, dueAt, workspace, extra);
      await refresh();
      setShowAddForm(false);
    } catch (error) {
      setLoadError(error.message);
    }
  }

  async function handleEdit(task, values) {
    try { await updateTask(task.id, values); await refresh(); }
    catch (error) { setLoadError(error.message); }
  }

  async function handleComplete(id) {
    try {
      await completeTask(id);
      await refresh();
    } catch (error) {
      setLoadError(error.message);
    }
  }

  async function handleDeleteCompleted(task) {
    if (!window.confirm(`Permanently delete “${task.text}”?`)) return;
    try {
      await deleteTask(task.id);
      await refresh();
      setEditingTask((current) => current?.id === task.id ? null : current);
    } catch (error) {
      setLoadError(error.message);
    }
  }

  async function handleEnableNotifications() {
    try {
      setPushStatus(await enablePushNotifications());
      setLoadError("");
    } catch (error) {
      setLoadError(error.message);
      setPushStatus(await reconcilePushNotifications().catch(() => ({ state: "error", detail: error.message })));
    }
  }

  async function handleDisableNotifications() {
    try { setPushStatus(await disablePushNotifications()); }
    catch (error) { setLoadError(error.message); }
  }

  async function handleTestNotification() {
    try {
      setPushStatus(await sendPushTest());
      setLoadError("");
    } catch (error) { setLoadError(error.message); }
  }

  async function handleRetryNotifications() {
    try {
      await retryPushDeliveries();
      setPushStatus(await reconcilePushNotifications());
    } catch (error) { setLoadError(error.message); }
  }

  const pushEnabled = pushStatus.state === "enabled";
  const visible = useMemo(() => {
    let list = tab === "completed" ? tasks.filter((task) => task.done_at) : tasks.filter((task) => !task.done_at);
    if (activeWorkspace !== "All") list = list.filter((task) => (task.workspace || "Personal") === activeWorkspace);
    if (tab === "today") list = list.filter((task) => isToday(task.due_at) || !task.due_at);
    if (query.trim()) list = list.filter((task) => task.text.toLowerCase().includes(query.trim().toLowerCase()));
    if (tab === "completed") return [...list].sort((a, b) => (b.done_at || "").localeCompare(a.done_at || ""));
    return [...list].sort((a, b) => {
      if (sortByDue) {
        if (!a.due_at) return 1;
        if (!b.due_at) return -1;
        return a.due_at.localeCompare(b.due_at);
      }
      return b.created_at.localeCompare(a.created_at);
    });
  }, [tasks, tab, query, sortByDue, activeWorkspace]);

  const openTasks = tasks.filter((task) => !task.done_at);
  const todayCount = openTasks.filter((task) => isToday(task.due_at)).length;
  const defaultWorkspace = activeWorkspace === "All" ? workspaces[0] : activeWorkspace;
  const workspaceCounts = useMemo(() => {
    const counts = {};
    for (const task of openTasks) counts[task.workspace || "Personal"] = (counts[task.workspace || "Personal"] || 0) + 1;
    return counts;
  }, [openTasks]);
  const doneToday = tasks.filter((task) => task.done_at && isToday(task.done_at)).length;
  const calendarTasks = activeWorkspace === "All" ? openTasks : openTasks.filter((task) => task.workspace === activeWorkspace);

  async function finishOnboarding(values) {
    await completeOnboarding(values);
    const next = await fetchBootstrap();
    setOnboardingRequired(Boolean(next.onboarding_required));
    setNameState(next.name);
    setProfile({ name: next.name, timezone: next.timezone, assistantGender: next.assistant_gender, assistantVoice: next.assistant_voice });
    saveName(next.name);
    setWorkspaces(next.workspaces);
    setWorkspaceColors(next.workspace_colors || {});
  }

  async function restartOnboarding() {
    await resetOnboarding();
    setOnboardingRequired(true);
  }

  return (
    <div className="shell">
      <Sidebar
        name={name} workspaces={workspaces} activeWorkspace={activeWorkspace}
        onSelectWorkspace={handleSelectWorkspace} onAddWorkspace={handleAddWorkspace} onManageWorkspace={(mode, workspace) => setWorkspaceDialog({ mode, workspace })} workspaceColors={workspaceColors} pushEnabled={pushEnabled} capabilities={capabilities}
        onAdd={() => setShowAddForm(true)} counts={workspaceCounts} totalOpen={openTasks.length} doneToday={doneToday}
        view={view} onNavigate={setView} onTalk={() => setVoiceOpen(true)} onLogout={onLogout}
      />
      <div className="main"><div className="app">
        {loadError && <div className="app-error" role="alert">{loadError}</div>}
        <div className="topbar">
          <Header name={name} onNameChange={handleNameChange} onSettings={() => setView("settings")} onLogout={onLogout}
            workspaces={workspaces} activeWorkspace={activeWorkspace} onSelectWorkspace={handleSelectWorkspace} onAddWorkspace={handleAddWorkspace} onManageWorkspace={(mode, workspace) => setWorkspaceDialog({ mode, workspace })} workspaceColors={workspaceColors} />
          <TodayCard pendingToday={todayCount} totalOpen={openTasks.length} />
        </div>
        <WorkspaceSwitcher className="mobile-only" workspaces={workspaces} active={activeWorkspace}
          onSelect={handleSelectWorkspace} onAdd={handleAddWorkspace} onManage={(mode, workspace) => setWorkspaceDialog({ mode, workspace })} workspaceColors={workspaceColors} />

        {view === "calendar" ? <CalendarView tasks={calendarTasks} workspaces={workspaces} workspaceColors={workspaceColors} onComplete={handleComplete} />
          : view === "notifications" ? <NotificationsView tasks={calendarTasks} pushStatus={pushStatus}
              onEnableNotifications={handleEnableNotifications} onDisableNotifications={handleDisableNotifications}
              onTestNotification={handleTestNotification} onRetryNotifications={handleRetryNotifications} />
          : view.startsWith("memories") ? <Suspense fallback={<div className="empty">Opening Memories…</div>}><MemoriesView activeWorkspace={activeWorkspace} section={view.split("-")[1] || "overview"} onSectionChange={(section) => setView(`memories-${section}`)} /></Suspense>
          : view.startsWith("email") ? <Suspense fallback={<div className="empty">Opening email…</div>}><EmailView workspaces={workspaces} defaultWorkspace={defaultWorkspace} onTaskCreated={refresh} outlookConfigured={capabilities.outlook} accountsInitiallyOpen={view === "email-accounts"} /></Suspense>
          : view === "settings" ? <SettingsView authMode={authMode} profile={profile} capabilities={{ ...capabilities, push: pushEnabled }} onSave={handleSettingsSave} onRestartOnboarding={restartOnboarding} onClose={() => setView("home")} />
          : <>
            <div className="toolbar"><div className="search-row"><SearchBar value={query} onChange={setQuery} />
              <button className={`add-toggle-btn ${showAddForm ? "open" : ""}`} onClick={() => setShowAddForm((state) => !state)} aria-label="Toggle add task">
                {showAddForm ? <X size={19} /> : <Plus size={19} />}</button></div><Tabs value={tab} onChange={setTab} /></div>
            {showAddForm && <AddTaskForm inputRef={addInputRef} onAdd={handleAdd} workspaces={workspaces} defaultWorkspace={defaultWorkspace} />}
            <div className="agenda-col"><AgendaHeader completed={tab === "completed"} sortByDue={sortByDue} onToggleSort={() => setSortByDue((state) => !state)} />
              {tab === "completed"
                ? <CompletedTaskList tasks={visible} onEdit={(task) => setEditingTask(task)} onDelete={handleDeleteCompleted} />
                : <TaskList tasks={visible} onComplete={handleComplete} onEdit={(task) => setEditingTask(task)} />}</div>
          </>}
      </div></div>
          <BottomNav pushEnabled={pushEnabled} capabilities={capabilities} onAdd={() => setShowAddForm((state) => !state)} addOpen={showAddForm}
        view={view} onNavigate={setView} onTalk={() => setVoiceOpen(true)} voiceOpen={voiceOpen} />
      {voiceOpen && <Suspense fallback={null}><VoicePanel onClose={() => setVoiceOpen(false)} onTaskChange={refresh} activeWorkspace={activeWorkspace} /></Suspense>}
      {editingTask && <TaskEditor task={editingTask} workspaces={workspaces} onClose={() => setEditingTask(null)} onSave={async (values) => { await handleEdit(editingTask, values); setEditingTask(null); }} />}
      {workspaceDialog && <WorkspaceDialog dialog={workspaceDialog} currentColor={workspaceColors[workspaceDialog.workspace]} onClose={() => setWorkspaceDialog(null)} onConfirm={handleWorkspaceDialogConfirm} />}
      {emailDraft && <EmailDraftDialog initial={emailDraft} onClose={() => setEmailDraft(null)} />}
      {onboardingRequired && <OnboardingDialog initial={profile} capabilities={capabilities} onComplete={finishOnboarding} />}
    </div>
  );
}

function OnboardingDialog({ initial, capabilities, onComplete }) {
  const [draft, setDraft] = useState({ name: initial.name || "", timezone: initial.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", assistant_gender: initial.assistantGender || "she", assistant_voice: initial.assistantVoice || "Zephyr" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const previewRef = useRef(null);
  const voices = ASSISTANT_VOICES;
  const timezones = [draft.timezone, "UTC", "Asia/Kolkata", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Singapore"].filter((value, index, list) => value && list.indexOf(value) === index);
  async function submit(event) {
    event.preventDefault(); setSaving(true); setError("");
    try { await onComplete(draft); } catch (e) { setError(e.message || "Could not save setup"); } finally { setSaving(false); }
  }
  useEffect(() => () => previewRef.current?.(), []);
  async function previewVoice() {
    previewRef.current?.(); setPreviewing(true); setError("");
    const playback = new PlaybackQueue(); let connection; let timer; let disposed = false; let resolveOpen;
    const opened = new Promise((resolve) => { resolveOpen = resolve; });
    const cleanup = () => { if (disposed) return; disposed = true; clearTimeout(timer); connection?.disconnect(); playback.dispose(); previewRef.current = null; setPreviewing(false); };
    previewRef.current = cleanup;
    try {
      await updateProfile({ name: draft.name.trim() || "User", timezone: draft.timezone, assistant_gender: draft.assistant_gender, assistant_voice: draft.assistant_voice });
      await playback.init();
      connection = new VoiceConnectionManager({
        onOpen: () => resolveOpen(true), onAudio: (audio) => playback.enqueueAudio(audio), onModelText: () => {}, onTranscript: () => {}, onInterrupted: () => {}, onToolResult: () => {}, onGoAway: () => {}, onReconnecting: () => {}, onClose: () => {},
        onError: (message) => { resolveOpen(false); setError(message || "Could not preview this voice"); cleanup(); },
        onTurnComplete: () => { connection.disconnect(); const drain = () => playback.bufferedMs() > 0 ? timer = setTimeout(drain, 150) : cleanup(); timer = setTimeout(drain, 150); },
      });
      await connection.connect(); if (!await opened) return;
      connection.sendText("Voice preview only. Say exactly: Hi, I'm Nudge. This is how I sound.");
    } catch (e) { setError(e.message || "Could not preview this voice"); cleanup(); }
  }
  return <div className="onboarding-overlay"><form className="onboarding-card" onSubmit={submit}>
    <div className="onboarding-mark"><span>~</span></div><p className="eyebrow">WELCOME TO NUDGE</p><h1>Let’s make Nudge yours.</h1><p className="onboarding-copy">A few quick choices personalize your assistant. You can change them later in Settings.</p>
    <label>What should Nudge call you?<input autoFocus required maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Your name" /></label>
    <label>Timezone<select value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}>{timezones.map((value) => <option key={value}>{value}</option>)}</select></label>
    <fieldset><legend>Assistant</legend><div className="onboarding-segment">{["she", "he"].map((value) => <button type="button" key={value} className={draft.assistant_gender === value ? "active" : ""} onClick={() => setDraft({ ...draft, assistant_gender: value })}>{value === "she" ? "She" : "He"}</button>)}</div></fieldset>
    <label>Voice<select value={draft.assistant_voice} onChange={(e) => setDraft({ ...draft, assistant_voice: e.target.value })}>{voices.map(({ name, tone }) => <option value={name} key={name}>{name} · {tone}</option>)}</select></label>
    <button type="button" className="voice-preview-btn" onClick={previewVoice} disabled={!capabilities.gemini || previewing}>{previewing ? <LoaderCircle className="spin" size={15} /> : <Volume2 size={15} />}{previewing ? "Playing preview…" : `Preview ${draft.assistant_voice}`}</button>
    {!capabilities.gemini && <p className="onboarding-hint">Voice previews become available after Gemini is connected in Settings.</p>}
    {error && <p className="onboarding-error">{error}</p>}<button className="onboarding-submit" disabled={saving}>{saving ? "Saving…" : "Start using Nudge"}</button>
  </form></div>;
}
