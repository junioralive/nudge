import { useEffect, useMemo, useState } from "react";
import { Archive, ArrowLeft, CheckCircle2, ChevronRight, Circle, Inbox, LoaderCircle, Mail, RefreshCw, Search, SquareCheckBig, Trash2, X } from "lucide-react";
import {
  archiveEmail,
  addEmailAccount,
  createTaskFromEmail,
  fetchEmailAccounts,
  fetchEmailInbox,
  fetchEmailMessage,
  searchEmail,
  removeEmailAccount,
  startOutlookOAuth,
  testEmailAccount,
  updateEmailAccount,
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

export default function EmailView({ workspaces, defaultWorkspace, onTaskCreated, outlookConfigured = false }) {
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
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [accountForm, setAccountForm] = useState({ name: "", email: "", imapHost: "", imapPort: "993", password: "", smtpHost: "", smtpPort: "465" });
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountStatus, setAccountStatus] = useState("");
  const [editingAccountId, setEditingAccountId] = useState("");

  const unread = useMemo(() => messages.filter((item) => !item.seen).length, [messages]);

  async function loadInbox(nextAccount = accountId, connectedAccounts = accounts) {
    setLoading(true);
    setError("");
    if (!connectedAccounts.length) {
      setMessages([]);
      setSummary({ total: 0, failed: 0 });
      setLoading(false);
      return;
    }
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

  async function loadAccounts() {
    const result = await fetchEmailAccounts();
    setAccounts(result.accounts || []);
    return result.accounts || [];
  }

  useEffect(() => {
    fetchEmailAccounts()
      .then(async (accountResult) => {
        const connected = accountResult.accounts || [];
        setAccounts(connected);
        if (!connected.length) {
          setMessages([]);
          setSummary({ total: 0, failed: 0 });
          return;
        }
        const inboxResult = await fetchEmailInbox("", 25);
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

  async function connectOutlook() {
    setAccountBusy(true);
    setAccountStatus("");
    try {
      const result = await startOutlookOAuth("Outlook");
      window.location.assign(result.url);
    } catch (requestError) {
      setAccountStatus(requestError.message);
      setAccountBusy(false);
    }
  }

  function editAccount(account) {
    setEditingAccountId(account.id);
    setAccountForm({
      name: account.name || "",
      email: account.email || "",
      imapHost: account.imapHost || "",
      imapPort: String(account.imapPort || 993),
      password: "",
      smtpHost: account.smtpHost || "",
      smtpPort: String(account.smtpPort || 465),
    });
    setAccountStatus("");
  }

  async function reconnectOutlook(account) {
    setAccountBusy(true);
    setAccountStatus("");
    try {
      const result = await startOutlookOAuth(account.name || "Outlook", account.id);
      window.location.assign(result.url);
    } catch (requestError) {
      setAccountStatus(requestError.message);
      setAccountBusy(false);
    }
  }

  async function addAccount(event) {
    event.preventDefault();
    setAccountBusy(true);
    setAccountStatus("");
    try {
      const values = { ...accountForm, imapPort: Number(accountForm.imapPort), smtpPort: accountForm.smtpHost ? Number(accountForm.smtpPort) : undefined };
      if (editingAccountId) await updateEmailAccount(editingAccountId, values);
      else await addEmailAccount(values);
      const connected = await loadAccounts();
      setAccountForm({ name: "", email: "", imapHost: "", imapPort: "993", password: "", smtpHost: "", smtpPort: "465" });
      setAccountStatus(editingAccountId ? "Account updated." : "Account connected.");
      setEditingAccountId("");
      await loadInbox(accountId, connected);
    } catch (requestError) {
      setAccountStatus(requestError.message);
    } finally {
      setAccountBusy(false);
    }
  }

  async function testAccount(id) {
    setAccountBusy(true);
    setAccountStatus("");
    try {
      await testEmailAccount(id);
      setAccountStatus("Connection healthy.");
    } catch (requestError) {
      setAccountStatus(requestError.message);
    } finally {
      setAccountBusy(false);
    }
  }

  async function removeAccount(id) {
    if (!window.confirm("Remove this email account from Nudge?")) return;
    setAccountBusy(true);
    try {
      await removeEmailAccount(id);
      const connected = await loadAccounts();
      const nextAccount = accountId === id ? "" : accountId;
      setAccountId(nextAccount);
      await loadInbox(nextAccount, connected);
      setAccountStatus("Account removed.");
    } catch (requestError) {
      setAccountStatus(requestError.message);
    } finally {
      setAccountBusy(false);
    }
  }

  return <section className="email-view">
    <div className="email-overview">
      <div><Inbox size={18} /><span><strong>{summary.total}</strong><small>Inbox messages</small></span></div>
      <div><Circle size={18} /><span><strong>{unread}</strong><small>Unread in view</small></span></div>
      <div className="email-account-card"><SquareCheckBig size={18} /><span><strong>{accounts.length}</strong><small>Connected accounts</small><button type="button" onClick={() => { setAccountsOpen(true); setAccountStatus(""); }}>Manage accounts</button></span></div>
    </div>

    <div className="email-toolbar">
      <form onSubmit={submitSearch}><Search size={17} /><input disabled={!accounts.length} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sender, subject, or keywords" /><button type="submit" disabled={!accounts.length}>Search</button></form>
      <button type="button" className="email-compose-btn" disabled={!accounts.length} onClick={() => setCompose({ accountId: accountId || accounts[0]?.id || "" })}><Mail size={16} /><span>New email</span></button>
      <select value={accountId} onChange={(event) => { setAccountId(event.target.value); setQuery(""); loadInbox(event.target.value); }}>
        <option value="">All accounts</option>
        {accounts.map((account) => <option value={account.id} key={account.id}>{account.name} · {account.email}</option>)}
      </select>
      <button type="button" className="email-refresh" onClick={() => loadInbox()} aria-label="Refresh inbox"><RefreshCw size={16} /></button>
    </div>

    {error && <div className="email-error" role="alert">{error}</div>}
    {summary.failed > 0 && <div className="email-warning">One or more accounts could not be reached. Other inboxes are still shown.</div>}

    <div className="email-list" aria-busy={loading}>
      {loading ? <div className="email-skeleton-list" aria-label="Loading inbox">
        {[1, 2, 3, 4, 5].map((item) => <div className="email-skeleton-row" key={item}>
          <span className="skeleton-circle" /><span className="skeleton-line sender" /><span className="skeleton-line subject" /><span className="skeleton-line date" />
        </div>)}
      </div>
        : messages.length === 0 ? <div className="email-empty"><Inbox size={24} /><h3>{accounts.length ? "No messages found" : "Connect an account"}</h3><p>{accounts.length ? "Try another account or search." : "Add an IMAP account to bring your inbox into Nudge."}</p>{!accounts.length && <button type="button" onClick={() => { setAccountsOpen(true); setAccountStatus(""); }}>Manage accounts</button>}</div>
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

    {accountsOpen && <section className="email-dialog-layer" role="dialog" aria-modal="true" aria-labelledby="email-accounts-title" onMouseDown={(event) => event.target === event.currentTarget && setAccountsOpen(false)}>
      <section className="email-account-dialog">
        <header className="floating-dialog-head"><div><SquareCheckBig size={18} /><h2 id="email-accounts-title">Email accounts</h2></div><button type="button" onClick={() => setAccountsOpen(false)} aria-label="Close account manager"><X size={18} /></button></header>
        <div className="email-account-body">
          {accounts.map((account) => <div className="email-account-row" key={account.id}><div><strong>{account.name}</strong><span>{account.email}</span></div><div><button type="button" onClick={() => testAccount(account.id)} disabled={accountBusy}>Test</button><button type="button" onClick={() => editAccount(account)} disabled={accountBusy}>Edit</button>{outlookConfigured && account.authType === "oauth2" && <button type="button" onClick={() => reconnectOutlook(account)} disabled={accountBusy}>Reconnect</button>}<button type="button" className="danger" onClick={() => removeAccount(account.id)} disabled={accountBusy}><Trash2 size={14} /></button></div></div>)}
          {!accounts.length && <p className="email-account-empty">No accounts connected yet.</p>}
          {outlookConfigured && <div className="email-account-connect"><button type="button" onClick={connectOutlook} disabled={accountBusy}>Connect Outlook</button><span>or add an IMAP account below</span></div>}
          <form className="email-account-form" onSubmit={addAccount}>
            <h3>{editingAccountId ? "Edit custom IMAP / SMTP" : "Add custom IMAP / SMTP"}</h3>
            <label><span>Name</span><input required value={accountForm.name} onChange={(event) => setAccountForm({ ...accountForm, name: event.target.value })} placeholder="Work mailbox" /></label>
            <label><span>Email</span><input required type="email" value={accountForm.email} onChange={(event) => setAccountForm({ ...accountForm, email: event.target.value })} placeholder="you@example.com" /></label>
            <label><span>IMAP host</span><input required value={accountForm.imapHost} onChange={(event) => setAccountForm({ ...accountForm, imapHost: event.target.value })} placeholder="imap.example.com" /></label>
            <label><span>Password {editingAccountId && <em>optional</em>}</span><input required={!editingAccountId} type="password" autoComplete="new-password" value={accountForm.password} onChange={(event) => setAccountForm({ ...accountForm, password: event.target.value })} /></label>
            <label><span>SMTP host <em>optional</em></span><input value={accountForm.smtpHost} onChange={(event) => setAccountForm({ ...accountForm, smtpHost: event.target.value })} placeholder="smtp.example.com" /></label>
            <button className="primary" type="submit" disabled={accountBusy || !accountForm.name || !accountForm.email || !accountForm.imapHost || (!editingAccountId && !accountForm.password)}>{accountBusy ? "Saving…" : editingAccountId ? "Save account" : "Add account"}</button>
          </form>
          {accountStatus && <p className="email-account-status" role="status">{accountStatus}</p>}
        </div>
      </section>
    </section>}
  </section>;
}
