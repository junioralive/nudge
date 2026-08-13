import { CalendarClock, Mail, MessageCircle, RefreshCw, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cancelAutomation, fetchAutomations, retryAutomation } from "../api.js";

function localTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

const LABELS = { pending: "Scheduled", sending: "Sending", sent: "Sent", failed: "Failed", "delivery-unknown": "Check delivery", cancelled: "Cancelled" };

export default function AutomationList({ source }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState(null);

  async function load() {
    setLoading(true); setError("");
    try { setItems((await fetchAutomations(source)).automations || []); }
    catch (requestError) { setError(requestError.message || "Could not load automations"); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [source]);

  async function cancel(item) {
    setBusy(item.id);
    try { await cancelAutomation(item.id, source); setConfirmation(null); await load(); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(0); }
  }

  async function retry(item) {
    setBusy(item.id);
    try { await retryAutomation(item.id, source); setConfirmation(null); await load(); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(0); }
  }

  const Icon = source === "email" ? Mail : MessageCircle;
  return <section className="automation-panel" aria-busy={loading}>
    <header><div><CalendarClock size={20} /><span><h2>{source === "email" ? "Email" : "WhatsApp"} automations</h2><p>Scheduled actions run at the approved time.</p></span></div><button type="button" onClick={load} aria-label="Refresh automations"><RefreshCw size={16} /></button></header>
    {error && <div className="automation-error" role="alert">{error}</div>}
    {loading ? <div className="automation-skeleton">{[1, 2, 3].map((id) => <div key={id}><i /><span /><small /></div>)}</div>
      : !items.length ? <div className="automation-empty"><Icon size={24} /><h3>No {source} automations yet</h3><p>Ask Nudge to schedule one and it will appear here.</p></div>
        : <div className="automation-list">{items.map((item) => <article key={item.id}>
          <div className="automation-source-icon"><Icon size={18} /></div>
          <div className="automation-copy"><div><strong>{source === "email" ? item.subject : item.recipient}</strong><span className={`automation-status status-${item.status}`}>{LABELS[item.status] || item.status}</span></div>{source === "email" && <small>To {item.recipients?.join(", ")} · {item.accountName}</small>}<p>{item.preview}</p><footer><time>{localTime(item.scheduledAt)}</time><span>{item.attempts || 0} attempt{item.attempts === 1 ? "" : "s"}</span></footer>{item.error && <em>{item.error}</em>}</div>
          <div className="automation-actions">{["pending", "failed"].includes(item.status) && <button type="button" disabled={busy === item.id} onClick={() => setConfirmation({ kind: "cancel", item })} aria-label="Cancel automation"><Trash2 size={15} /></button>}{["failed", "delivery-unknown"].includes(item.status) && <button type="button" disabled={busy === item.id} onClick={() => setConfirmation({ kind: "retry", item })} aria-label="Retry automation"><RotateCcw size={15} /></button>}</div>
        </article>)}</div>}
    {confirmation && <div className="automation-confirm-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setConfirmation(null)}><section className="automation-confirm" role="dialog" aria-modal="true" aria-labelledby="automation-confirm-title">
      <header><div><h3 id="automation-confirm-title">{confirmation.kind === "cancel" ? "Cancel automation?" : "Retry automation?"}</h3><p>{confirmation.kind === "cancel" ? `This scheduled ${source === "email" ? "email" : "WhatsApp message"} will not be sent.` : confirmation.item.status === "delivery-unknown" ? "Delivery may already have happened. Check the sent conversation or folder before retrying." : "Nudge will attempt this delivery again."}</p></div><button type="button" onClick={() => setConfirmation(null)} aria-label="Close"><X size={18} /></button></header>
      <div className="automation-confirm-preview">{confirmation.item.subject || confirmation.item.recipient}<small>{confirmation.item.preview}</small></div>
      <footer><button type="button" className="secondary" onClick={() => setConfirmation(null)}>Keep it</button><button type="button" className={confirmation.kind === "cancel" ? "danger" : "primary"} disabled={busy === confirmation.item.id} onClick={() => confirmation.kind === "cancel" ? cancel(confirmation.item) : retry(confirmation.item)}>{confirmation.kind === "cancel" ? "Cancel automation" : "Retry now"}</button></footer>
    </section></div>}
  </section>;
}
