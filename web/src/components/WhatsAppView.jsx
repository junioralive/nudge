import { ArrowLeft, Check, LoaderCircle, MessageCircle, RefreshCw, Search, Send, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchWhatsAppChats, fetchWhatsAppMessages, fetchWhatsAppStatus, prepareWhatsAppMessage, sendWhatsAppMessage } from "../api.js";

function time(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export default function WhatsAppView() {
  const [status, setStatus] = useState(null);
  const [chats, setChats] = useState([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [approval, setApproval] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef(null);

  async function loadChats(search = query) {
    setLoading(true); setError("");
    try {
      const [nextStatus, result] = await Promise.all([fetchWhatsAppStatus(), fetchWhatsAppChats(search)]);
      setStatus(nextStatus); setChats(result.chats || []);
    } catch (e) { setError(e.message || "Could not load WhatsApp"); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadChats(""); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: "end" }); }, [messages]);

  async function openChat(chat) {
    setSelected(chat); setLoading(true); setError(""); setApproval(null); setDraft("");
    try { setMessages((await fetchWhatsAppMessages(chat.jid)).messages || []); }
    catch (e) { setError(e.message || "Could not load this chat"); }
    finally { setLoading(false); }
  }

  async function review() {
    if (!selected || !draft.trim()) return;
    setBusy(true); setError("");
    try { setApproval(await prepareWhatsAppMessage(selected.jid, draft.trim())); }
    catch (e) { setError(e.message || "Could not prepare message"); }
    finally { setBusy(false); }
  }

  async function confirmSend() {
    if (!approval?.approval) return;
    setBusy(true); setError("");
    try {
      await sendWhatsAppMessage(approval.approval);
      setApproval(null); setDraft("");
      setMessages((await fetchWhatsAppMessages(selected.jid)).messages || []);
    } catch (e) { setError(e.message || "Could not send message"); }
    finally { setBusy(false); }
  }

  const orderedMessages = useMemo(() => [...messages].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)), [messages]);

  return <section className="whatsapp-view">
    <header className="whatsapp-head">
      <div><span className="whatsapp-brand"><MessageCircle size={18} /> WhatsApp</span><p>{status?.connected && status?.loggedIn ? "Connected securely through your private bridge" : "Connection needs attention"}</p></div>
      <button type="button" className="icon-action" onClick={() => selected ? openChat(selected) : loadChats()} aria-label="Refresh"><RefreshCw size={17} /></button>
    </header>

    {error && <div className="whatsapp-error" role="alert">{error}</div>}
    {!selected ? <>
      <form className="whatsapp-search" onSubmit={(e) => { e.preventDefault(); loadChats(); }}>
        <Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" /><button>Search</button>
      </form>
      <div className="whatsapp-list">
        {loading ? Array.from({ length: 7 }, (_, index) => <div className="whatsapp-chat skeleton" key={index}><i /><span /><small /></div>)
          : chats.length ? chats.map((chat) => <button className="whatsapp-chat" key={chat.jid} onClick={() => openChat(chat)}>
            <i>{chat.name.slice(0, 1).toUpperCase()}</i><span><strong>{chat.name}</strong><small>{chat.archived ? "Archived" : chat.jid.endsWith("@g.us") ? "Group" : "WhatsApp"}</small></span><time>{time(chat.lastMessageAt)}</time>
          </button>) : <div className="whatsapp-empty">No chats found.</div>}
      </div>
    </> : <div className="whatsapp-conversation">
      <div className="whatsapp-conversation-head"><button type="button" onClick={() => { setSelected(null); setMessages([]); setApproval(null); }}><ArrowLeft size={18} /> Back</button><div><strong>{selected.name}</strong><small>{selected.jid.endsWith("@g.us") ? "Group" : "WhatsApp chat"}</small></div></div>
      <div className="whatsapp-messages">
        {loading ? <LoaderCircle className="spin" size={24} /> : orderedMessages.map((message) => <article className={message.fromMe ? "from-me" : "from-them"} key={message.id || `${message.timestamp}-${message.content}`}>
          {!message.fromMe && <b>{message.sender}</b>}<p>{message.content || (message.mediaType ? `[${message.mediaType}${message.filename ? ` · ${message.filename}` : ""}]` : "Message")}</p><time>{time(message.timestamp)}</time>
        </article>)}<span ref={bottomRef} />
      </div>
      <div className="whatsapp-composer"><textarea maxLength={10000} value={draft} onChange={(e) => { setDraft(e.target.value); setApproval(null); }} placeholder={`Message ${selected.name}`} /><button type="button" onClick={review} disabled={busy || !draft.trim()}><Send size={16} /> Review</button></div>
    </div>}

    {approval && <div className="whatsapp-review-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setApproval(null)}><div className="whatsapp-review" role="dialog" aria-modal="true" aria-labelledby="whatsapp-review-title">
      <header><div><h3 id="whatsapp-review-title">Send to {selected?.name}</h3><p>Review this message before it leaves Nudge.</p></div><button type="button" onClick={() => setApproval(null)} aria-label="Close"><X size={18} /></button></header>
      <div className="whatsapp-review-message">{approval.preview.message}</div>
      <footer><button type="button" className="secondary" onClick={() => setApproval(null)}>Keep editing</button><button type="button" onClick={confirmSend} disabled={busy}>{busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} Confirm send</button></footer>
    </div></div>}
  </section>;
}
