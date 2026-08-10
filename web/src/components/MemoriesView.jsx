import { useEffect, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { createMemory, deleteMemory, fetchRecentMemories, searchMemories } from "../api.js";

function entriesFrom(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.results)) return response.results;
  if (Array.isArray(response?.entries)) return response.entries;
  return [];
}

function tagsFrom(entry) {
  if (Array.isArray(entry.tags)) return entry.tags;
  if (typeof entry.tags !== "string") return [];
  try {
    const parsed = JSON.parse(entry.tags);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return entry.tags.split(",").map((tag) => tag.trim()).filter(Boolean);
  }
}

export default function MemoriesView({ activeWorkspace }) {
  const [entries, setEntries] = useState([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function loadRecent() {
    setLoading(true);
    setMessage("");
    try {
      setEntries(entriesFrom(await fetchRecentMemories(activeWorkspace)));
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setQuery("");
    loadRecent();
  }, [activeWorkspace]);

  async function search(event) {
    event.preventDefault();
    if (!query.trim()) return loadRecent();
    setLoading(true);
    setMessage("");
    try {
      setEntries(entriesFrom(await searchMemories(query.trim(), activeWorkspace)));
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function remember(event) {
    event.preventDefault();
    if (!draft.trim()) return;
    setSaving(true);
    setMessage("");
    try {
      await createMemory(draft.trim(), activeWorkspace);
      setDraft("");
      await loadRecent();
      setMessage("Remembered.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function forget(entry) {
    const preview = String(entry.content || "this memory").slice(0, 90);
    if (!window.confirm(`Permanently forget “${preview}”?`)) return;
    try {
      await deleteMemory(entry.id);
      setEntries((current) => current.filter((item) => item.id !== entry.id));
      setMessage("Memory permanently forgotten.");
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <div className="memories-view">
      <form className="memory-capture" onSubmit={remember}>
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="What should Nudge remember?" />
        <button disabled={saving || !draft.trim()}><Plus size={17} /> {saving ? "Saving…" : "Remember"}</button>
      </form>

      <form className="memory-search" onSubmit={search}>
        <Search size={17} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by meaning…" />
        <button>Search</button>
      </form>

      {message && <div className="memory-message">{message}</div>}
      {loading ? <div className="memory-list memory-list-skeleton" aria-label="Loading memories">
        {[1, 2, 3].map((item) => <article className="memory-card memory-card-skeleton" key={item}>
          <span className="skeleton-line wide" />
          <span className="skeleton-line medium" />
          <div className="memory-meta"><span className="skeleton-chip" /><span className="skeleton-chip short" /></div>
        </article>)}
      </div> : entries.length === 0 ? (
        <div className="empty">No matching memories.</div>
      ) : (
        <div className="memory-list">
          {entries.map((entry) => (
            <article className="memory-card" key={entry.id}>
              <p>{entry.content}</p>
              <div className="memory-meta">
                <span>{entry.created_at ? new Date(entry.created_at).toLocaleDateString() : "Memory"}</span>
                <div>{tagsFrom(entry).slice(0, 4).map((tag) => <span className="memory-tag" key={tag}>{tag}</span>)}</div>
                <button onClick={() => forget(entry)} aria-label="Forget memory"><Trash2 size={15} /></button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
