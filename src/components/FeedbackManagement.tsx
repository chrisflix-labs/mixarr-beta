"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, Trash2 } from "lucide-react";
import styles from "./FeedbackManagement.module.css";

const tabs = [["tracks", "Tracks"], ["artists", "Artists"], ["fits", "Playlist fits"], ["transitions", "Transitions"]] as const;
async function request(path: string, init?: RequestInit) { const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error?.message || payload.error || "Request failed"); return payload; }

export default function FeedbackManagement() {
  const [type, setType] = useState("tracks"); const [query, setQuery] = useState(""); const [page, setPage] = useState(1); const [data, setData] = useState<any>({ items: [], total: 0, pageSize: 25 }); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const load = useCallback(async () => { setBusy(true); setError(""); try { setData(await request(`/api/feedback/management?type=${encodeURIComponent(type)}&query=${encodeURIComponent(query)}&page=${page}&pageSize=25`)); } catch (caught) { setError(caught instanceof Error ? caught.message : "Feedback is unavailable"); } finally { setBusy(false); } }, [type, query, page]);
  useEffect(() => { void load(); }, [load]);
  async function clear(item: any) { setBusy(true); setError(""); try { if (type === "tracks") await request("/api/feedback/tracks", { method: "DELETE", body: JSON.stringify({ trackId: item.trackId, sourceSurface: "API" }) }); else if (type === "artists") await request("/api/feedback/artists", { method: "DELETE", body: JSON.stringify({ artistId: item.artistId, sourceSurface: "API" }) }); else await request("/api/feedback/management", { method: "DELETE", body: JSON.stringify({ type, id: item.id }) }); await load(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not clear feedback"); } finally { setBusy(false); } }
  function title(item: any) { if (type === "artists") return item.artist.title; if (type === "transitions") return `${item.previousTrack.title} → ${item.currentTrack.title}`; return `${item.track.title} — ${item.track.artist.title}`; }
  function detail(item: any) { if (type === "fits") return `${item.state.replaceAll("_", " ")} · ${item.playlistProfile?.name || item.playlist?.plexPlaylistTitle || "Unsaved preview"}${item.reason ? ` · ${item.reason.replaceAll("_", " ")}` : ""}`; if (type === "transitions") return `${item.playlist?.plexPlaylistTitle || "Playlist preview"}${item.reason ? ` · ${item.reason.replaceAll("_", " ")}` : ""}`; return `${item.state.replaceAll("_", " ")} · adjustment ${item.scoreAdjustment > 0 ? "+" : ""}${item.scoreAdjustment}`; }
  const pages = Math.max(1, Math.ceil((data.total || 0) / (data.pageSize || 25)));
  return <section className={styles.section} aria-labelledby="feedback-management-title">
    <div className={styles.heading}><div><h3 id="feedback-management-title">Likes, dislikes &amp; feedback</h3><p>Review the explicit signals Mixarr stores locally for your recommendations.</p></div><form onSubmit={(event) => { event.preventDefault(); setPage(1); void load(); }}><label><span className="sr-only">Search feedback</span><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search feedback" /></label></form></div>
    <div className={styles.tabs} role="tablist">{tabs.map(([value, label]) => <button role="tab" aria-selected={type === value} key={value} onClick={() => { setType(value); setPage(1); }}>{label}</button>)}</div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.list}>{busy && !data.items.length ? <p>Loading feedback…</p> : data.items.length ? data.items.map((item: any) => <article key={item.id}><div><strong>{title(item)}</strong><small>{detail(item)}</small><small>{new Date(item.updatedAt || item.createdAt).toLocaleString()}</small></div><button onClick={() => void clear(item)} disabled={busy} aria-label={`Clear feedback for ${title(item)}`}><Trash2 size={14} /> Clear</button></article>) : <p>No feedback matches this view.</p>}</div>
    <div className={styles.pager}><span>{data.total || 0} total</span><button disabled={page <= 1 || busy} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} of {pages}</span><button disabled={page >= pages || busy} onClick={() => setPage((value) => value + 1)}>Next</button></div>
  </section>;
}
