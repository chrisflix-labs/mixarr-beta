"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw, Search, ShieldCheck } from "lucide-react";
import styles from "../library-health.module.css";

type Conflict = {
  id: string; plexRatingKey: string; plexGuid: string | null; conflictReason: string; duplicateConfidence: string | null;
  resolutionStatus: string; hasInheritedData: boolean; firstDetectedAt: string; lastSyncBatchId: string | null;
  track: null | { id: string; title: string; duration: number | null; fileFormat: string | null; mediaPath: string | null; artist: { title: string }; album: { title: string } };
  candidates: Array<{ id: string; title: string; artist: { title: string }; album: { title: string } }>;
  dataAvailableFromDuplicate: boolean;
};

type Preview = { unresolvedPlexTracks: number; newTrackInstancesExpected: number; possibleDuplicateGroups: number; existingEnrichmentAvailable: number; manualReviewRecommended: number; plexReported: number; mixarrActive: number };

export default function PlexConflictInspector({ searchParams }: { searchParams: { libraryId?: string; status?: string; search?: string } }) {
  const libraryId = searchParams.libraryId || "";
  const [rows, setRows] = useState<Conflict[]>([]);
  const [reasons, setReasons] = useState<string[]>([]);
  const [search, setSearch] = useState(searchParams.search || "");
  const [reason, setReason] = useState("");
  const [confidence, setConfidence] = useState("");
  const [status, setStatus] = useState(searchParams.status || "unresolved");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(nextPage = page) {
    const query = new URLSearchParams({ page: String(nextPage), pageSize: "50", status });
    if (libraryId) query.set("libraryId", libraryId);
    if (search) query.set("search", search);
    if (reason) query.set("reason", reason);
    if (confidence) query.set("confidence", confidence);
    const response = await fetch(`/api/library-health/plex-conflicts?${query}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load conflicts");
    setRows(data.conflicts); setReasons(data.reasons); setPagination(data.pagination); setPage(nextPage); setSelected(new Set());
  }

  // `load` intentionally captures the submitted filters; scope/status changes reset to page one.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(1).catch((error) => setMessage(error.message)); }, [libraryId, status]);

  async function previewRepair() {
    if (!libraryId) return setMessage("Open the inspector from a specific library card to preview repair.");
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/library-health/plex-conflicts/repair?libraryId=${encodeURIComponent(libraryId)}`, { cache: "no-store" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Preview failed"); setPreview(data);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Preview failed"); } finally { setBusy(false); }
  }

  async function runRepair() {
    setBusy(true);
    try {
      const response = await fetch("/api/library-health/plex-conflicts/repair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ libraryId }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Repair could not start"); setMessage(data.message); setPreview(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Repair could not start"); } finally { setBusy(false); }
  }

  async function rowAction(id: string, action: string, extra: Record<string, string> = {}) {
    setBusy(true);
    try {
      const response = await fetch(`/api/library-health/plex-conflicts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Action failed"); await load(page);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Action failed"); } finally { setBusy(false); }
  }

  async function bulk(action: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/library-health/plex-conflicts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, libraryId: libraryId || undefined, conflictIds: selected.size ? Array.from(selected) : undefined }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Bulk action failed"); setMessage(data.message || `Processed ${data.processed} record${data.processed === 1 ? "" : "s"}.`); await load(page);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Bulk action failed"); } finally { setBusy(false); }
  }

  function submit(event: FormEvent) { event.preventDefault(); void load(1); }
  return <main className={styles.page}>
    <header className={styles.header}><div><Link href="/settings/library-health" className={styles.back}><ArrowLeft size={15} /> Library Health</Link><h2>Plex Conflict Inspector</h2><p>Every current Plex item is stored as its own active track. Legacy omissions remain listed until the repair scan creates their track instances.</p></div><button className={styles.primaryButton} onClick={() => void previewRepair()} disabled={busy || !libraryId}><ShieldCheck size={16} /> Repair Unresolved Plex Tracks</button></header>
    {message && <p className={styles.notice}>{message}</p>}
    {preview && <section className="glass-panel" aria-label="Repair preview"><h3>Repair preview</h3><div className={styles.statsGrid}>
      <div><span>Unresolved Plex tracks</span><strong>{preview.unresolvedPlexTracks.toLocaleString()}</strong></div><div><span>New track instances expected</span><strong>{preview.newTrackInstancesExpected.toLocaleString()}</strong></div><div><span>Possible duplicate groups</span><strong>{preview.possibleDuplicateGroups.toLocaleString()}</strong></div><div><span>Existing enrichment available</span><strong>{preview.existingEnrichmentAvailable.toLocaleString()}</strong></div><div><span>Manual review recommended</span><strong>{preview.manualReviewRecommended.toLocaleString()}</strong></div>
    </div><p>This operation never deletes or merges physical tracks. Repeating it will not recreate an existing server/library/rating-key instance.</p><div className={styles.actions}><button className={styles.primaryButton} onClick={() => void runRepair()} disabled={busy}><RefreshCw size={15} /> Run repair</button><button className={styles.secondaryButton} onClick={() => setPreview(null)}>Cancel</button></div></section>}
    <section className="glass-panel">
      <form className={styles.filters} onSubmit={submit}><label>Search<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Title, artist, album, key, GUID" /></label><label>Conflict reason<select value={reason} onChange={(event) => setReason(event.target.value)}><option value="">All reasons</option>{reasons.map((value) => <option key={value}>{value}</option>)}</select></label><label>Confidence<select value={confidence} onChange={(event) => setConfidence(event.target.value)}><option value="">All confidence</option><option value="high">Exact duplicate</option><option value="medium">Probable duplicate</option><option value="low">Needs review</option></select></label><label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="unresolved">Unresolved</option><option value="all">All</option><option value="resolved_grouped">Resolved/grouped</option><option value="resolved_separate">Resolved/separate</option></select></label><button className={styles.primaryButton} type="submit"><Search size={15} /> Search</button></form>
      <div className={styles.actions}><button className={styles.secondaryButton} disabled={busy} onClick={() => void bulk("save_all_separate")}>Save all as separate tracks</button><button className={styles.secondaryButton} disabled={busy} onClick={() => void bulk("auto_group_high_confidence")}>Auto-group high-confidence duplicates</button><button className={styles.secondaryButton} disabled={busy} onClick={() => void bulk("apply_available_enrichment")}>Apply available enrichment</button><button className={styles.secondaryButton} disabled={busy || !selected.size} onClick={() => void bulk("reanalyze_selected")}>Reanalyze selected</button><button className={styles.secondaryButton} disabled={busy || !selected.size} onClick={() => void bulk("mark_selected_reviewed")}>Mark selected reviewed</button></div>
      <div className={styles.tableWrap}><table><thead><tr><th><span className="sr-only">Select</span></th><th>Track</th><th>Plex identity</th><th>Media</th><th>Conflict</th><th>Candidate records</th><th>Status</th><th>Actions</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><input type="checkbox" checked={selected.has(row.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); event.target.checked ? next.add(row.id) : next.delete(row.id); return next; })} aria-label={`Select ${row.track?.title || row.plexRatingKey}`} /></td><td><strong>{row.track?.title || "Unpersisted Plex item"}</strong><small className={styles.trackMeta}>{row.track ? `${row.track.artist.title} · ${row.track.album.title}` : "Run repair to create this track instance"}</small></td><td><code>{row.plexRatingKey}</code><small className={styles.trackMeta}>{row.plexGuid || "No GUID"}</small></td><td>{row.track?.fileFormat || "Unknown"}<small className={styles.trackMeta} title={row.track?.mediaPath || ""}>{row.track?.mediaPath ? `…${row.track.mediaPath.slice(-54)}` : "No path"}</small></td><td>{row.conflictReason}<small className={styles.trackMeta}>{row.duplicateConfidence || "unscored"}{row.dataAvailableFromDuplicate ? " · inherited data available" : ""}</small></td><td>{row.candidates.length ? row.candidates.map((candidate) => <small className={styles.trackMeta} key={candidate.id}>{candidate.artist.title} — {candidate.title} ({candidate.album.title})</small>) : "None"}</td><td>{row.resolutionStatus}<small className={styles.trackMeta}>{new Date(row.firstDetectedAt).toLocaleString()}</small></td><td><div className={styles.actions}><button className={styles.tableAction} disabled={busy || !row.track} onClick={() => void rowAction(row.id, "save_separate")}>Save separately</button>{row.candidates[0] && row.track && <button className={styles.tableAction} disabled={busy} onClick={() => void rowAction(row.id, "create_group", { candidateTrackId: row.candidates[0].id })}>Create group</button>}<button className={styles.tableAction} disabled={busy || !row.track} onClick={() => void rowAction(row.id, "mark_not_duplicate")}>Not a duplicate</button><button className={styles.tableAction} disabled={busy || !row.track} onClick={() => void rowAction(row.id, "apply_enrichment")}>Apply enrichment</button><button className={styles.tableAction} disabled={busy || !row.track} onClick={() => void rowAction(row.id, "analyze_separately")}>Analyze separately</button></div></td></tr>)}</tbody></table></div>
      {!rows.length && <p>No records match these filters.</p>}<div className={styles.pagination}><span>{pagination.total.toLocaleString()} records</span><div><button aria-label="Previous page" disabled={page <= 1} onClick={() => void load(page - 1)}><ChevronLeft size={16} /></button><span>Page {page} of {pagination.totalPages}</span><button aria-label="Next page" disabled={page >= pagination.totalPages} onClick={() => void load(page + 1)}><ChevronRight size={16} /></button></div></div>
    </section>
  </main>;
}
