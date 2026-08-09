import { useEffect, useState } from "react";
import { Check, LoaderCircle, Mail, Send, X } from "lucide-react";
import { createEmailDraft, fetchEmailAccounts, sendEmailDraft } from "../api.js";

function recipients(value) {
  const entries = String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
  return entries.length > 1 ? entries : entries[0] || undefined;
}

export default function EmailDraftDialog({ initial = {}, onClose, onSent }) {
  const [accounts, setAccounts] = useState([]);
  const [draft, setDraft] = useState({
    accountId: initial.accountId || "",
    replyToRef: initial.replyToRef || "",
    replyAll: Boolean(initial.replyAll),
    to: initial.to || "",
    cc: initial.cc || "",
    subject: initial.subject || "",
    text: initial.text || "",
  });
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    fetchEmailAccounts().then(({ accounts: rows }) => {
      setAccounts(rows || []);
      setDraft((current) => ({ ...current, accountId: current.accountId || rows?.[0]?.id || "" }));
    }).catch((error) => setStatus(error.message));
  }, []);

  useEffect(() => {
    const close = (event) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);

  function update(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
    setStatus("");
  }

  async function saveDraft(event) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const result = await createEmailDraft({
        ...draft,
        to: recipients(draft.to),
        cc: recipients(draft.cc),
      });
      setSaved(result);
      setStatus("Draft saved to your mailbox. Review it once more before sending.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendDraft() {
    setBusy(true);
    setStatus("");
    try {
      const result = await sendEmailDraft(saved.sendApproval);
      if (!result.sent) throw new Error("The mail server did not accept this message.");
      setStatus("Email sent");
      window.setTimeout(() => { onSent?.(); onClose(); }, 500);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="email-dialog-layer" role="dialog" aria-modal="true" aria-labelledby="email-draft-title" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form className="email-draft-dialog" onSubmit={saveDraft}>
      <header className="floating-dialog-head">
        <div><Mail size={18} /><h2 id="email-draft-title">{draft.replyToRef ? "Reply" : "New email"}</h2></div>
        <button type="button" onClick={onClose} aria-label="Close email draft"><X size={18} /></button>
      </header>

      <div className="email-draft-body">
        <label><span>From</span><select value={draft.accountId} onChange={(event) => update("accountId", event.target.value)} disabled={Boolean(saved)}>
          {accounts.map((account) => <option value={account.id} key={account.id}>{account.name} · {account.email}</option>)}
        </select></label>
        <label><span>To</span><input type="text" value={draft.to} onChange={(event) => update("to", event.target.value)} placeholder="name@example.com" disabled={Boolean(saved)} /></label>
        <label><span>Cc</span><input type="text" value={draft.cc} onChange={(event) => update("cc", event.target.value)} placeholder="Optional" disabled={Boolean(saved)} /></label>
        <label><span>Subject</span><input type="text" maxLength={1000} value={draft.subject} onChange={(event) => update("subject", event.target.value)} disabled={Boolean(saved)} /></label>
        <label className="email-message-field"><span>Message</span><textarea maxLength={50000} value={draft.text} onChange={(event) => update("text", event.target.value)} disabled={Boolean(saved)} /></label>
      </div>

      <footer className="email-draft-footer">
        <p className={status === "Email sent" ? "success" : ""}>{status}</p>
        {!saved ? <button type="submit" disabled={busy || !draft.accountId || !draft.text.trim()}>{busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} Save draft</button>
          : <button type="button" className="send-email-btn" disabled={busy} onClick={sendDraft}>{busy ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />} Send email</button>}
      </footer>
    </form>
  </section>;
}
