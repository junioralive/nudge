import { useEffect, useMemo, useState } from "react";
import { Archive, ArrowLeft, CheckCircle2, ChevronRight, Circle, Inbox, LoaderCircle, Mail, RefreshCw, Search, SquareCheckBig, X } from "lucide-react";
import {
  archiveEmail,
  createTaskFromEmail,
  fetchEmailAccounts,
  fetchEmailInbox,
  fetchEmailMessage,
  searchEmail,
  updateEmailMessageState,
} from "../api.js";
import EmailDraftDialog from "./EmailDraftDialog.jsx";

function formattedDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function senderName(value) {
  return String(value || "Unknown sender").replace(/\s*<[^>]+>\s*$/, "").replace(/^"|"$/g, "") || value;
}

export default function EmailView({ workspaces, defaultWorkspace, onTaskCreated }) {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [messages, setMessages] = useState([]);
  const [summary, setSummary] = useState({ total: 0, failed: 0 });
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [message, setMessage] = useState(null);
  const [compose, setCompose] = useState(null);
  const [taskDraft, setTaskDraft] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);

  const unread = useMemo(() => messages.filter((item) => !item.seen).length, [messages]);

  async function loadInbox(nextAccount = accountId) {
    setLoading(true);
    setError("");
    try {
      const result = await fetchEmailInbox(nextAccount, 25);
      setMessages(result.messages || []);
      setSummary({ total: result.total || 0, failed: result.failed || 0 });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    Promise.all([fetchEmailAccounts(), fetchEmailInbox("", 25)])
      .then(([accountResult, inboxResult]) => {
        setAccounts(accountResult.accounts || []);
        setMessages(inboxResult.messages || []);
        setSummary({ total: inboxResult.total || 0, failed: inboxResult.failed || 0 });
      })
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, []);

  async function submitSearch(event) {
    event.preventDefault();
    if (!query.trim()) return loadInbox();
    setLoading(true);
    setError("");
    try {
      const result = await searchEmail(query.trim(), accountId ? [accountId] : [], 25);
      setMessages(result.messages || []);
      setSummary({ total: result.total || 0, failed: result.failed || 0 });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  async function openMessage(item) {
    setSelected(item);
    setMessage(null);
    setActionBusy(true);
    setError("");
    try { setMessage(await fetchEmailMessage(item.ref)); }
    catch (requestError) { setError(requestError.message); }
    finally { setActionBusy(false); }
  }

  async function toggleRead(item) {
    setActionBusy(true);
    try {
      const state = item.seen ? "unread" : "read";
      await updateEmailMessageState(state, item.seen ? item.approvals.markUnread : item.approvals.markRead);
      setMessages((current) => current.map((row) => row.ref === item.ref ? { ...row, seen: !item.seen } : row));
      setSelected((current) => current?.ref === item.ref ? { ...current, seen: !item.seen } : current);
    } catch (requestError) { setError(requestError.message); }
    finally { setActionBusy(false); }
  }

  async function archive(item) {
    setActionBusy(true);
    try {
      await archiveEmail(item.approvals.archive);
      setMessages((current) => current.filter((row) => row.ref !== item.ref));
      setSelected(null);
      setMessage(null);
    } catch (requestError) { setError(requestError.message); }
    finally { setActionBusy(false); }
  }

  async function saveTask(event) {
    event.preventDefault();
    setActionBusy(true);
    try {
      await createTaskFromEmail({
        ref: selected.ref,
        text: taskDraft.text,
        details: taskDraft.details,
        workspace: taskDraft.workspace,
        due_at: taskDraft.due_at ? new Date(taskDraft.due_at).toISOString() : null,
      });
      setTaskDraft(null);
      onTaskCreated?.();
    } catch (requestError) { setError(requestError.message); }
    finally { setActionBusy(false); }
  }

  return <section className="email-view">
    <div className="email-overview">
      <div><Inbox size={18} /><span><strong>{summary.total}</strong><small>Inbox messages</small></span></div>
      <div><Circle size={18} /><span><strong>{unread}</strong><small>Unread in view</small></span></div>
      <div><SquareCheckBig size={18} /><span><strong>{accounts.length}</strong><small>Connected accounts</small></span></div>
    </div>

    <div className="email-toolbar">
      <form onSubmit={submitSearch}><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sender, subject, or keywords" /><button type="submit">Search</button></form>
      <button type="button" className="email-compose-btn" onClick={() => setCompose({ accountId: accountId || accounts[0]?.id || "" })}><Mail size={16} /><span>New email</span></button>
      <select value={accountId} onChange={(event) => { setAccountId(event.target.value); setQuery(""); loadInbox(event.target.value); }}>
        <option value="">All accounts</option>
        {accounts.map((account) => <option value={account.id} key={account.id}>{account.name} · {account.email}</option>)}
      </select>
      <button type="button" className="email-refresh" onClick={() => loadInbox()} aria-label="Refresh inbox"><RefreshCw size={16} /></button>
    </div>

    {error && <div className="email-error" role="alert">{error}</div>}
    {summary.failed > 0 && <div className="email-warning">One or more accounts could not be reached. Other inboxes are still shown.</div>}

    <div className="email-list" aria-busy={loading}>
      {loading ? <div className="email-empty"><LoaderCircle className="spin" size={22} /><p>Checking your inbox…</p></div>
        : messages.length === 0 ? <div className="email-empty"><Inbox size={24} /><h3>No messages found</h3><p>Try another account or search.</p></div>
          : messages.map((item) => <button type="button" className={`email-row ${item.seen ? "seen" : "unread"}`} key={item.ref} onClick={() => openMessage(item)}>
            <span className="email-read-dot" />
            <span className="email-row-from">{senderName(item.from)}</span>
            <span className="email-row-subject">{item.subject}</span>
            <span className="email-row-account">{item.accountName}</span>
            <time>{formattedDate(item.date)}</time>
            <ChevronRight size={16} />
          </button>)}
    </div>

    {selected && <section className="email-message-layer" role="dialog" aria-modal="true" aria-labelledby="email-message-title">
      <article className="email-message-panel">
        <header className="floating-dialog-head">
          <div><button type="button" onClick={() => { setSelected(null); setMessage(null); }} aria-label="Back to inbox"><ArrowLeft size={18} /></button><h2 id="email-message-title">Message</h2></div>
          <button type="button" onClick={() => { setSelected(null); setMessage(null); }} aria-label="Close message"><X size={18} /></button>
        </header>
        <div className="email-message-meta">
          <span>{selected.accountName} · {selected.accountEmail}</span>
          <h3>{selected.subject}</h3>
          <p><strong>From</strong> {selected.from}</p>
          <p><strong>To</strong> {selected.to}</p>
          <time>{formattedDate(selected.date)}</time>
        </div>
        <div className="email-message-content">{actionBusy && !message ? <LoaderCircle className="spin" size={20} /> : <pre>{message?.text || "No readable message body."}</pre>}</div>
        <footer className="email-message-actions">
          <button type="button" onClick={() => toggleRead(selected)} disabled={actionBusy}>{selected.seen ? "Mark unread" : "Mark read"}</button>
          <button type="button" onClick={() => archive(selected)} disabled={actionBusy}><Archive size={15} /> Archive</button>
          <button type="button" onClick={() => setTaskDraft({ text: `Reply to ${senderName(selected.from)}: ${selected.subject}`, details: "", workspace: defaultWorkspace || "Personal", due_at: "" })}>Create task</button>
          <button type="button" className="primary" onClick={() => setCompose({ accountId: selected.accountId, replyToRef: selected.ref, to: selected.from.match(/<([^>]+)>/)?.[1] || selected.from, subject: selected.subject.toLowerCase().startsWith("re:") ? selected.subject : `Re: ${selected.subject}` })}>Reply</button>
        </footer>
      </article>
    </section>}

    {taskDraft && <section className="email-dialog-layer" role="dialog" aria-modal="true" aria-labelledby="email-task-title" onMouseDown={(event) => event.target === event.currentTarget && setTaskDraft(null)}>
      <form className="email-task-dialog" onSubmit={saveTask}>
        <header className="floating-dialog-head"><div><CheckCircle2 size={18} /><h2 id="email-task-title">Create task</h2></div><button type="button" onClick={() => setTaskDraft(null)} aria-label="Close task form"><X size={18} /></button></header>
        <div className="email-task-fields">
          <label><span>Title</span><input maxLength={200} value={taskDraft.text} onChange={(event) => setTaskDraft({ ...taskDraft, text: event.target.value })} /></label>
          <label><span>Details</span><textarea maxLength={10000} value={taskDraft.details} onChange={(event) => setTaskDraft({ ...taskDraft, details: event.target.value })} /></label>
          <label><span>Workspace</span><select value={taskDraft.workspace} onChange={(event) => setTaskDraft({ ...taskDraft, workspace: event.target.value })}>{workspaces.map((workspace) => <option key={workspace}>{workspace}</option>)}</select></label>
          <label><span>Due</span><input type="datetime-local" value={taskDraft.due_at} onChange={(event) => setTaskDraft({ ...taskDraft, due_at: event.target.value })} /></label>
        </div>
        <footer className="email-draft-footer"><span /><button type="submit" disabled={actionBusy || !taskDraft.text.trim()}>Create task</button></footer>
      </form>
    </section>}

    {compose && <EmailDraftDialog initial={compose} onClose={() => setCompose(null)} onSent={() => loadInbox()} />}
  </section>;
}
