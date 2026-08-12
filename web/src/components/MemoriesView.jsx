import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Archive, ArrowRight, Brain, Download, Link2, MessageCircleQuestion, Plus, RefreshCw, Search, Sparkles, Trash2, Upload, X } from "lucide-react";
import {
  appendMemory,
  askMemories,
  createMemory,
  deleteMemory,
  downloadMemoriesExport,
  fetchMemoriesHealth,
  fetchMemoryConfig,
  fetchMemoryGraph,
  fetchMemoryReindexStatus,
  fetchMemoryStats,
  fetchRecentMemories,
  searchMemories,
  importMemoriesBackup,
  reindexMemoriesBatch,
  setMemoryStatus,
  updateMemory,
} from "../api.js";

const SECTIONS = [
  ["overview", "Overview", Sparkles],
  ["ask", "Ask", MessageCircleQuestion],
  ["library", "Library", Search],
  ["graph", "Graph", Link2],
  ["settings", "Backup", Archive],
];

function entriesFrom(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.results)) return response.results;
  if (Array.isArray(response?.entries)) return response.entries;
  return [];
}

function tagsFrom(entry) {
  if (Array.isArray(entry?.tags)) return entry.tags;
  try { return JSON.parse(entry?.tags || "[]"); } catch { return []; }
}

function Skeleton() {
  return <div className="memory-list memory-list-skeleton" aria-label="Loading memories">{[1, 2, 3].map((item) => <article className="memory-card memory-card-skeleton" key={item}><span className="skeleton-line wide" /><span className="skeleton-line medium" /><div className="memory-meta"><span className="skeleton-chip" /><span className="skeleton-chip short" /></div></article>)}</div>;
}

function MemoryCard({ entry, onOpen }) {
  return <button className="memory-card memory-card-button" onClick={() => onOpen(entry)}>
    <p>{entry.content}</p>
    <div className="memory-meta"><span>{entry.created_at ? new Date(entry.created_at).toLocaleDateString() : "Memory"}</span><div>{tagsFrom(entry).filter((tag) => !tag.startsWith("status:")).slice(0, 4).map((tag) => <span className="memory-tag" key={tag}>{tag}</span>)}</div><ArrowRight size={15} /></div>
  </button>;
}

export default function MemoriesView({ activeWorkspace, section = "overview", onSectionChange }) {
  const [entries, setEntries] = useState([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [stats, setStats] = useState(null);
  const [health, setHealth] = useState(null);
  const [graph, setGraph] = useState({ nodes: [], edges: [] });
  const [ask, setAsk] = useState("");
  const [answer, setAnswer] = useState(null);
  const [selected, setSelected] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [config, setConfig] = useState(null);
  const [reindex, setReindex] = useState(null);

  async function loadRecent() {
    setLoading(true); setMessage("");
    try { setEntries(entriesFrom(await fetchRecentMemories(activeWorkspace, section === "overview" ? 8 : 60))); }
    catch (error) { setMessage(error.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { setQuery(""); loadRecent(); }, [activeWorkspace, section]);
  useEffect(() => {
    if (section === "overview") Promise.all([fetchMemoryStats(), fetchMemoriesHealth()]).then(([nextStats, nextHealth]) => { setStats(nextStats); setHealth(nextHealth); }).catch(() => {});
    if (section === "graph") { setLoading(true); fetchMemoryGraph().then(setGraph).catch((error) => setMessage(error.message)).finally(() => setLoading(false)); }
    if (section === "settings") Promise.all([fetchMemoryConfig(), fetchMemoriesHealth(), fetchMemoryStats(), fetchMemoryReindexStatus()]).then(([nextConfig, nextHealth, nextStats, nextReindex]) => { setConfig(nextConfig); setHealth(nextHealth); setStats(nextStats); setReindex(nextReindex); }).catch((error) => setMessage(error.message));
  }, [section]);

  async function remember(event) {
    event.preventDefault(); if (!draft.trim()) return;
    setSaving(true); setMessage("");
    try {
      const result = await createMemory(draft.trim(), activeWorkspace);
      setDraft(""); await loadRecent();
      const receipt = result.status === "merged" ? "Merged with an existing memory" : result.status === "replaced" ? "Replaced an older memory" : "Saved to Memories";
      setMessage(`${receipt} · ${activeWorkspace === "All" ? "All workspaces" : activeWorkspace}`);
    } catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  }

  async function search(event) {
    event.preventDefault();
    if (!query.trim()) return loadRecent();
    setLoading(true); setMessage("");
    try { setEntries(entriesFrom(await searchMemories(query.trim(), activeWorkspace, 40))); }
    catch (error) { setMessage(error.message); }
    finally { setLoading(false); }
  }

  async function submitAsk(event) {
    event.preventDefault(); if (!ask.trim()) return;
    setSaving(true); setAnswer(null); setMessage("");
    try { setAnswer(await askMemories(ask.trim(), activeWorkspace)); }
    catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  }

  const filtered = useMemo(() => statusFilter === "all" ? entries : entries.filter((entry) => (entry.status || "canonical") === statusFilter), [entries, statusFilter]);
  const nodeMap = useMemo(() => Object.fromEntries((graph.nodes || []).map((node) => [node.id, node])), [graph]);

  return <div className="memories-view">
    <nav className="email-section-nav memory-section-nav" aria-label="Memory sections">{SECTIONS.map(([key, label, Icon]) => <button type="button" className={section === key ? "active" : ""} key={key} onClick={() => onSectionChange?.(key)}><Icon size={16} />{label}</button>)}</nav>

    {section === "overview" && <>
      <form className="memory-capture" onSubmit={remember}><div className="memory-capture-label"><Sparkles size={16} /> Capture something worth keeping</div><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="A preference, decision, relationship, or project fact…" /><button disabled={saving || !draft.trim()}><Plus size={17} /> {saving ? "Saving…" : "Remember"}</button></form>
      <div className="memory-stat-grid"><article><strong>{stats?.total ?? "—"}</strong><span>Memories</span></article><article><strong>{stats?.edges ?? "—"}</strong><span>Connections</span></article><article><strong>{stats?.recalls ?? "—"}</strong><span>Recalls</span></article><article><strong className={health?.healthy ? "healthy" : ""}>{health?.healthy ? "Healthy" : "Checking"}</strong><span>Engine</span></article></div>
      <div className="memory-section-title"><h2>Recent memories</h2><button onClick={() => onSectionChange?.("library")}>Open library <ArrowRight size={14} /></button></div>
      {loading ? <Skeleton /> : entries.length ? <div className="memory-list">{entries.map((entry) => <MemoryCard entry={entry} onOpen={setSelected} key={entry.id} />)}</div> : <div className="empty"><Brain size={25} /><h3>Your Memories are ready</h3><p>Capture a durable fact above. Tasks and email stay separate.</p></div>}
    </>}

    {section === "ask" && <div className="memory-ask-layout"><form className="memory-ask-card" onSubmit={submitAsk}><MessageCircleQuestion size={24} /><h2>Ask what your Memories know</h2><p>Answers use retrieved memories only and cite every source.</p><textarea value={ask} onChange={(event) => setAsk(event.target.value)} placeholder="What did I decide about…?" /><button disabled={saving || !ask.trim()}>{saving ? "Looking through Memories…" : "Ask Memories"}</button></form>{answer && <article className="memory-answer"><h3>Answer</h3><p>{answer.answer}</p><div className="memory-sources"><strong>Sources</strong>{answer.sources?.map((source) => <button key={source.id} onClick={() => setSelected(source)}><span>{source.content}</span><small>{source.id}</small></button>)}</div></article>}</div>}

    {section === "library" && <><div className="memory-library-tools"><form className="memory-search" onSubmit={search}><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by meaning…" /><button>Search</button></form><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All states</option><option value="canonical">Canonical</option><option value="draft">Draft</option><option value="deprecated">Deprecated</option></select></div>{loading ? <Skeleton /> : filtered.length ? <div className="memory-list">{filtered.map((entry) => <MemoryCard entry={entry} onOpen={setSelected} key={entry.id} />)}</div> : <div className="empty">No matching memories.</div>}</>}

    {section === "graph" && <>{loading ? <Skeleton /> : graph.nodes?.length ? <div className="memory-graph"><div className="memory-graph-nodes">{graph.nodes.map((node) => <button key={node.id} onClick={() => setSelected(node)}><Link2 size={14} /><span>{node.label}</span></button>)}</div><div className="memory-graph-links">{graph.edges.map((edge, index) => <article key={`${edge.source}-${edge.target}-${index}`}><span>{nodeMap[edge.source]?.label || edge.source}</span><small>{edge.type.replaceAll("_", " ")}</small><span>{nodeMap[edge.target]?.label || edge.target}</span></article>)}</div></div> : <div className="empty"><Link2 size={25} /><h3>No connections yet</h3><p>Connections appear as Memories learn how durable facts relate.</p></div>}</>}

    {section === "settings" && <div className="memory-settings-grid"><article><h3>Engine health</h3><dl><div><dt>Database</dt><dd>{health?.database ? "Ready" : "Unavailable"}</dd></div><div><dt>Vector index</dt><dd>{health?.vectorize ? "Ready" : "Checking"}</dd></div><div><dt>Pending index</dt><dd>{stats?.pendingIndex ?? 0}</dd></div></dl></article><article><h3>Models</h3><dl><div><dt>Embeddings</dt><dd>{config?.effective?.EMBEDDING_MODEL || "Workers AI"}</dd></div><div><dt>Reasoning</dt><dd>{config?.effective?.LLM_MODEL || "Workers AI"}</dd></div></dl></article><article className="memory-backup-card"><Archive size={20} /><div><h3>Backup your Memories</h3><p>Export or restore entries, lifecycle metadata, and relationship edges.</p></div><div className="memory-backup-actions"><button onClick={() => downloadMemoriesExport().catch((error) => setMessage(error.message))}><Download size={15} /> Export</button><label className="memory-file-button"><Upload size={15} /> Import<input type="file" accept="application/json" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; setSaving(true); setMessage(""); try { const payload = JSON.parse(await file.text()); let offset = 0; let edgeOffset = 0; let result; do { result = await importMemoriesBackup(payload, offset, edgeOffset); offset = result.next_offset ?? offset; edgeOffset = result.next_edge_offset ?? edgeOffset; } while ((result.remaining_entries ?? 0) > 0 || (result.remaining_edges ?? 0) > 0); setMessage("Memories backup imported. Reindex to restore semantic search."); await loadRecent(); } catch (error) { setMessage(error.message); } finally { setSaving(false); event.target.value = ""; } }} /></label></div></article><article className="memory-backup-card"><RefreshCw size={20} /><div><h3>Rebuild semantic index</h3><p>{reindex?.estimate?.entries ?? 0} memories · {reindex?.estimate?.chunks ?? 0} vector chunks. Runs in safe batches.</p></div><button disabled={saving || reindex?.migration?.finishedAt} onClick={async () => { setSaving(true); setMessage(""); try { const result = await reindexMemoriesBatch(); setMessage(result.done ? "Semantic index is complete." : result.stalled ? result.stalledReason || "Reindex paused; retry later." : `${result.remaining} memories remain. Run another batch to continue.`); setReindex(await fetchMemoryReindexStatus()); } catch (error) { setMessage(error.message); } finally { setSaving(false); } }}><RefreshCw size={15} /> Run batch</button></article></div>}

    {message && <div className="memory-message">{message}</div>}
    {selected && createPortal(<MemoryEditor entry={selected} onClose={() => setSelected(null)} onChanged={async () => { setSelected(null); await loadRecent(); }} />, document.body)}
  </div>;
}

function MemoryEditor({ entry, onClose, onChanged }) {
  const [content, setContent] = useState(entry.content || entry.label || "");
  const [tags, setTags] = useState(tagsFrom(entry).filter((tag) => !tag.startsWith("status:")).join(", "));
  const [addition, setAddition] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function perform(action) { setBusy(true); setError(""); try { await action(); await onChanged(); } catch (requestError) { setError(requestError.message); } finally { setBusy(false); } }
  return <div className="memory-dialog-layer" role="dialog" aria-modal="true" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="memory-editor"><header><div><h2>Memory detail</h2><p>{entry.id}</p></div><button onClick={onClose} aria-label="Close"><X size={18} /></button></header><label>Content<textarea value={content} onChange={(event) => setContent(event.target.value)} /></label><label>Tags<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="personal, decision" /></label><label>Append an update<textarea className="compact" value={addition} onChange={(event) => setAddition(event.target.value)} placeholder="Add new context without replacing the original…" /></label>{error && <div className="memory-message">{error}</div>}<footer><button className="danger" disabled={busy} onClick={() => perform(() => deleteMemory(entry.id))}><Trash2 size={15} /> Forget</button><div><button disabled={busy} onClick={() => perform(() => setMemoryStatus(entry.id, "deprecated"))}>Deprecate</button>{addition.trim() && <button disabled={busy} onClick={() => perform(() => appendMemory(entry.id, addition.trim()))}>Append</button>}<button className="primary" disabled={busy || !content.trim()} onClick={() => perform(() => updateMemory(entry.id, content.trim(), tags.split(",").map((tag) => tag.trim()).filter(Boolean)))}>Save changes</button></div></footer></section></div>;
}
