import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import {
  bootstrapFromLocal,
  completeTask,
  createTask,
  createWorkspace,
  deleteTask,
  deleteWorkspace,
  fetchBootstrap,
  fetchCapabilities,
  fetchTasks,
  getSession,
  logout,
  updateProfile,
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

const VoicePanel = lazy(() => import("./components/VoicePanel.jsx"));
const MemoriesView = lazy(() => import("./components/MemoriesView.jsx"));
const EmailView = lazy(() => import("./components/EmailView.jsx"));

function isToday(dueAt) {
  if (!dueAt) return false;
  return new Date(dueAt).toDateString() === new Date().toDateString();
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(null);

  useEffect(() => {
    getSession().then((session) => setAuthenticated(session.authenticated)).catch(() => setAuthenticated(false));
    const lock = () => setAuthenticated(false);
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
    if (authenticated !== null) {
      const splash = document.getElementById("nudge-splash");
      if (splash) { splash.classList.add("done"); window.setTimeout(() => splash.remove(), 220); }
    }
  }, [authenticated]);

  if (authenticated === null) return <div className="app-loading">Loading Nudge…</div>;
  if (!authenticated) {
    return <LoginScreen />;
  }
  return <NudgeApp onLogout={async () => {
    const result = await logout();
    setAuthenticated(false);
    if (result?.logoutUrl) window.location.assign(result.logoutUrl);
  }} />;
}

function NudgeApp({ onLogout }) {
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
        if (!bootstrap.initialized) {
          await bootstrapFromLocal(getName(), getWorkspaces());
          bootstrap = await fetchBootstrap();
        }
        setNameState(bootstrap.name);
        setProfile({
          name: bootstrap.name,
          timezone: bootstrap.timezone,
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
          : view === "memories" ? <Suspense fallback={<div className="empty">Opening Second Brain…</div>}><MemoriesView activeWorkspace={activeWorkspace} /></Suspense>
          : view === "email" ? <Suspense fallback={<div className="empty">Opening email…</div>}><EmailView workspaces={workspaces} defaultWorkspace={defaultWorkspace} onTaskCreated={refresh} outlookConfigured={capabilities.outlook} /></Suspense>
          : view === "settings" ? <SettingsView profile={profile} capabilities={{ ...capabilities, push: pushEnabled }} onSave={handleSettingsSave} onClose={() => setView("home")} />
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
    </div>
  );
}
