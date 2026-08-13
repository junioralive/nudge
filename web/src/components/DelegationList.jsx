import { AlertTriangle, Bot, CheckCircle2, Clock3, LoaderCircle, Pause, Play, RefreshCw, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchDelegation, fetchDelegations, pauseDelegation, resumeDelegation, stopDelegation } from "../api.js";

function when(value) { return value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—"; }
function remaining(value) {
  if (!value) return "—";
  const minutes = Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 60000));
  return minutes > 1440 ? `${Math.ceil(minutes / 1440)} days left` : minutes > 60 ? `${Math.ceil(minutes / 60)} hours left` : `${minutes} min left`;
}

export default function DelegationList({ source }) {
  const [items, setItems] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [selected, setSelected] = useState(null); const [confirm, setConfirm] = useState(null); const [busy, setBusy] = useState(false);
  async function load() { setLoading(true); setError(""); try { setItems((await fetchDelegations(source)).delegations || []); } catch (e) { setError(e.message); } finally { setLoading(false); } }
  useEffect(() => { load(); }, [source]);
  async function open(id) { setBusy(true); try { setSelected(await fetchDelegation(id)); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function action(kind, id) {
    setBusy(true); setError("");
    try { if (kind === "pause") await pauseDelegation(id); else if (kind === "resume") await resumeDelegation(id); else await stopDelegation(id); setConfirm(null); setSelected(null); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  if (loading) return <div className="delegation-list skeleton-list">{[1,2,3].map((id) => <div className="delegation-card skeleton" key={id}><i/><span/><small/></div>)}</div>;
  return <section className="delegation-section">
    <header><div><Bot size={20}/><div><h2>Delegated conversations</h2><p>Bounded conversations Nudge is handling for you.</p></div></div><button className="icon-action" onClick={load} aria-label="Refresh"><RefreshCw size={16}/></button></header>
    {error && <div className="whatsapp-error">{error}</div>}
    {!items.length ? <div className="delegation-empty"><Bot size={25}/><h3>No delegated conversations</h3><p>Ask Nudge to handle one direct {source === "email" ? "email thread" : "WhatsApp chat"} for a limited time.</p></div> : <div className="delegation-list">{items.map((item) => <article className="delegation-card" key={item.id}>
      <button className="delegation-main" onClick={() => open(item.id)}><span className={`delegation-state ${item.status}`}>{item.status === "needs-you" ? <AlertTriangle size={14}/> : item.status === "completed" ? <CheckCircle2 size={14}/> : <Clock3 size={14}/>} {item.status}</span><h3>{item.recipient}</h3><p>{item.objective}</p><small>{remaining(item.expiresAt)} · {item.repliesUsed}/{item.maxReplies} replies · Last activity {when(item.lastActivityAt)}</small></button>
      <div className="delegation-actions">{item.status === "active" && <button onClick={() => action("pause", item.id)}><Pause size={14}/>Pause</button>}{["paused","needs-you"].includes(item.status) && <button onClick={() => setConfirm({ kind:"resume", item })}><Play size={14}/>Resume</button>}{["active","paused","needs-you"].includes(item.status) && <button className="danger" onClick={() => setConfirm({ kind:"stop", item })}><Square size={14}/>Stop</button>}</div>
    </article>)}</div>}
    {selected && <div className="delegation-detail-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setSelected(null)}><article className="delegation-detail"><header><div><h3>{selected.recipient}</h3><p>{selected.objective}</p></div><button onClick={() => setSelected(null)}><X size={18}/></button></header><div className="delegation-outcome"><b>Outcome</b><p>{selected.summary || "Conversation is still in progress."}</p>{selected.outcome?.unresolved?.length > 0 && <ul>{selected.outcome.unresolved.map((item) => <li key={item}>{item}</li>)}</ul>}</div><div className="delegation-transcript">{(selected.events || []).map((event) => <div className={event.direction} key={event.id}><small>{event.direction} · {when(event.occurredAt)}</small><p>{event.content}</p></div>)}</div></article></div>}
    {confirm && <div className="delegation-confirm-backdrop"><div className="delegation-confirm"><AlertTriangle size={22}/><h3>{confirm.kind === "resume" ? "Resume delegation?" : "Stop delegation?"}</h3><p>{confirm.kind === "resume" ? "Nudge will continue replying within the original recipient, objective, time, and reply limits." : "Nudge will stop immediately and cannot resume this delegation."}</p><div><button onClick={() => setConfirm(null)}>Cancel</button><button className={confirm.kind === "stop" ? "danger" : "primary"} disabled={busy} onClick={() => action(confirm.kind, confirm.item.id)}>{busy ? <LoaderCircle className="spin" size={15}/> : null}{confirm.kind === "resume" ? "Confirm resume" : "Stop now"}</button></div></div></div>}
  </section>;
}
