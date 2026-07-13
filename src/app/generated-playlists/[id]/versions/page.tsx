"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Clock3, GitCompareArrows, History, Pin, PinOff, RotateCcw, Save, ShieldCheck, Trash2 } from "lucide-react";
import styles from "./versions.module.css";

type VersionSummary = {
  id: string; revisionNumber: number; reason: string; label?: string | null; description?: string | null;
  engineVersion?: string | null; applicationVersion?: string | null; trackCount: number; durationMs: number;
  isPinned: boolean; isCurrent: boolean; isAutomatic: boolean; syncStatus: string; createdAt: string;
};

function duration(ms: number) {
  const minutes = Math.round((ms || 0) / 60000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function reasonLabel(reason: string) {
  return reason.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function displayValue(value: unknown) {
  if (value == null) return "Not recorded";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (Array.isArray(value)) return value.join(", ") || "None";
  return String(value);
}

export default function PlaylistVersionsPage({ params }: { params: { id: string } }) {
  const [playlistName, setPlaylistName] = useState("Playlist");
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [compareId, setCompareId] = useState<string>("");
  const [comparison, setComparison] = useState<any>(null);
  const [restorePreview, setRestorePreview] = useState<any>(null);
  const [undoVersion, setUndoVersion] = useState<{ id: string; revisionNumber: number } | null>(null);
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadVersions(nextFilter = filter) {
    try {
      const response = await axios.get(`/api/playlists/${params.id}/versions`, { params: { filter: nextFilter === "all" ? undefined : nextFilter } });
      setPlaylistName(response.data.playlist.plexPlaylistTitle);
      setVersions(response.data.versions);
      setSelectedId((current) => current && response.data.versions.some((version: VersionSummary) => version.id === current) ? current : response.data.versions[0]?.id || null);
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || "Version history could not be loaded.");
    }
  }

  useEffect(() => { loadVersions(); }, [params.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!selectedId) return setDetail(null);
    setComparison(null);
    setRestorePreview(null);
    axios.get(`/api/playlists/${params.id}/versions/${selectedId}`).then((response) => setDetail(response.data)).catch((requestError) => setError(requestError.response?.data?.error || "Version could not be loaded."));
  }, [params.id, selectedId]);

  const selected = useMemo(() => versions.find((version) => version.id === selectedId) || null, [versions, selectedId]);

  async function compare() {
    if (!selectedId || !compareId) return;
    setBusy("compare"); setError("");
    try {
      const response = await axios.post(`/api/playlists/${params.id}/versions/compare`, { fromVersionId: selectedId, toVersionId: compareId });
      setComparison(response.data);
    } catch (requestError: any) { setError(requestError.response?.data?.error || "Comparison failed."); }
    finally { setBusy(""); }
  }

  async function compareCurrent() {
    const current = versions.find((version) => version.isCurrent);
    if (!current || current.id === selectedId) return;
    setCompareId(current.id);
    setBusy("compare"); setError("");
    try {
      const response = await axios.post(`/api/playlists/${params.id}/versions/compare`, { fromVersionId: selectedId, toVersionId: current.id });
      setComparison(response.data);
    } catch (requestError: any) { setError(requestError.response?.data?.error || "Comparison failed."); }
    finally { setBusy(""); }
  }

  async function previewRestore() {
    if (!selectedId) return;
    setBusy("restore-preview"); setError("");
    try { setRestorePreview((await axios.post(`/api/playlists/${params.id}/versions/${selectedId}/restore`, { confirm: false })).data); }
    catch (requestError: any) { setError(requestError.response?.data?.error || "Restore preview failed."); }
    finally { setBusy(""); }
  }

  async function applyRestore() {
    if (!selectedId || !restorePreview) return;
    setBusy("restore"); setError("");
    try {
      const missing = restorePreview.missingTracks.length > 0;
      const response = await axios.post(`/api/playlists/${params.id}/versions/${selectedId}/restore`, {
        confirm: true, expectedPlaylistUpdatedAt: restorePreview.current.updatedAt,
        missingTrackStrategy: missing ? "restore_available" : "cancel", restoreSettings: true, restorePlaylistMetadata: false,
      });
      setMessage(`Version ${selected?.revisionNumber} restored. The previous state was saved as Version ${response.data.safetyVersion.revisionNumber}.${response.data.syncStatus === "failed" ? " Plex synchronization failed and needs retry." : ""}`);
      setUndoVersion({ id: response.data.safetyVersion.id, revisionNumber: response.data.safetyVersion.revisionNumber });
      setRestorePreview(null); await loadVersions();
    } catch (requestError: any) { setError(requestError.response?.data?.error || "Restore failed. The playlist was not changed."); }
    finally { setBusy(""); }
  }

  async function togglePin() {
    if (!selected) return;
    await axios.patch(`/api/playlists/${params.id}/versions/${selected.id}`, { isPinned: !selected.isPinned });
    setMessage(selected.isPinned ? `Version ${selected.revisionNumber} unpinned.` : `Version ${selected.revisionNumber} pinned and protected from cleanup.`);
    await loadVersions();
  }

  async function undoRestore() {
    if (!undoVersion) return;
    setBusy("restore-preview"); setError("");
    try {
      setSelectedId(undoVersion.id);
      setRestorePreview((await axios.post(`/api/playlists/${params.id}/versions/${undoVersion.id}/restore`, { confirm: false })).data);
      setUndoVersion(null);
    } catch (requestError: any) { setError(requestError.response?.data?.error || "Undo preview failed."); }
    finally { setBusy(""); }
  }

  async function savePoint() {
    const label = window.prompt("Version label (optional)", "Best version so far");
    if (label === null) return;
    setBusy("save");
    try { await axios.post(`/api/playlists/${params.id}/versions`, { label, isPinned: true }); setMessage("Manual restore point saved and pinned."); await loadVersions(); }
    catch (requestError: any) { setError(requestError.response?.data?.error || "Restore point could not be saved."); }
    finally { setBusy(""); }
  }

  async function removeVersion() {
    if (!selected || selected.isCurrent || !window.confirm(`Delete Version ${selected.revisionNumber}? This permanently removes only the saved history entry.`)) return;
    try { await axios.delete(`/api/playlists/${params.id}/versions/${selected.id}`); setMessage(`Version ${selected.revisionNumber} deleted.`); setSelectedId(null); await loadVersions(); }
    catch (requestError: any) { setError(requestError.response?.data?.error || "Version could not be deleted."); }
  }

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><Link href="/generated-playlists" className={styles.back}><ArrowLeft size={15} /> Generated Playlists</Link><span className={styles.kicker}><History size={14} /> History & Restore</span><h2>Playlist Version History</h2><p>Review previous versions of <strong>{playlistName}</strong>, compare changes, and safely restore an earlier state.</p></div>
      <button className={styles.primaryButton} onClick={savePoint} disabled={Boolean(busy)}><Save size={15} /> Save Current Version</button>
    </header>
    {message && <div className={styles.success} role="status"><ShieldCheck size={16} /><span>{message}</span>{undoVersion && <button type="button" onClick={undoRestore}>Undo Restore (Version {undoVersion.revisionNumber})</button>}</div>}
    {error && <div className={styles.error} role="alert">{error}</div>}
    <nav className={styles.filters} aria-label="Version history filters">
      {[['all','All Changes'],['generation','Generation'],['regeneration','Regeneration'],['manual','Manual Edits'],['restore','Restores'],['pinned','Pinned']].map(([value,label]) => <button key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); loadVersions(value); }}>{label}</button>)}
    </nav>
    {!versions.length ? <section className={styles.empty}><History size={32} /><h3>No playlist history yet</h3><p>Future generations and playlist changes will appear here.</p></section> : <div className={styles.layout}>
      <section className={styles.timeline} aria-label="Playlist versions">
        {versions.map((version) => <button key={version.id} className={`${styles.versionCard} ${selectedId === version.id ? styles.selected : ""}`} onClick={() => setSelectedId(version.id)} aria-label={`Open Version ${version.revisionNumber}${version.isCurrent ? ", current" : ""}`}>
          <span className={styles.dot} /><span className={styles.versionTop}><strong>Version {version.revisionNumber}{version.isCurrent ? " — Current" : ""}</strong>{version.isPinned && <Pin size={14} aria-label="Pinned" />}</span>
          <span>{version.label || version.description || reasonLabel(version.reason)}</span><small><Clock3 size={12} /> {new Date(version.createdAt).toLocaleString()}</small><small>{version.engineVersion ? `Smart Mix Engine ${version.engineVersion}` : "Legacy version"} · {version.trackCount} tracks · {duration(version.durationMs)}</small>
        </button>)}
      </section>
      <section className={styles.detail} aria-live="polite">
        {!selected || !detail ? <p>Choose a version to inspect it.</p> : <>
          <div className={styles.detailHeader}><div><span className={styles.kicker}>Version {selected.revisionNumber}{selected.isCurrent ? " · Current" : ""}</span><h3>{selected.label || selected.description || reasonLabel(selected.reason)}</h3><p>{new Date(selected.createdAt).toLocaleString()} · {selected.engineVersion || "Legacy engine"} · Mixarr {selected.applicationVersion || "not recorded"}</p></div><div className={styles.actions}><button onClick={togglePin} aria-label={`${selected.isPinned ? "Unpin" : "Pin"} Version ${selected.revisionNumber}`}>{selected.isPinned ? <PinOff size={15} /> : <Pin size={15} />}{selected.isPinned ? "Unpin" : "Pin version"}</button>{!selected.isCurrent && <button className={styles.restoreButton} onClick={previewRestore} disabled={Boolean(busy)} aria-label={`Restore playlist Version ${selected.revisionNumber}`}><RotateCcw size={15} /> Restore This Version</button>}</div></div>
          {!detail.restorable && <div className={styles.error}>{detail.validationError}</div>}
          <div className={styles.stats}><div><span>Tracks</span><strong>{selected.trackCount}</strong></div><div><span>Duration</span><strong>{duration(selected.durationMs)}</strong></div><div><span>Saved score</span><strong>{detail.snapshot?.data.scores?.overallScore ?? "—"}</strong></div><div><span>Sync</span><strong>{selected.syncStatus}</strong></div></div>
          <div className={styles.compareBar}><label>Compare Version {selected.revisionNumber} with<select value={compareId} onChange={(event) => setCompareId(event.target.value)}><option value="">Choose a version</option>{versions.filter((version) => version.id !== selected.id).map((version) => <option key={version.id} value={version.id}>Version {version.revisionNumber}{version.isCurrent ? " — Current" : ""}</option>)}</select></label><button onClick={compare} disabled={!compareId || Boolean(busy)}><GitCompareArrows size={15} /> Compare</button>{!selected.isCurrent && <button onClick={compareCurrent} disabled={Boolean(busy)}>Compare with Current</button>}</div>
          {comparison && <section className={styles.comparison}><h4>Version {comparison.from.revisionNumber} versus Version {comparison.to.revisionNumber}</h4><div className={styles.changeStats}><span>Added <strong>{comparison.diff.summary.addedCount}</strong></span><span>Removed <strong>{comparison.diff.summary.removedCount}</strong></span><span>Moved <strong>{comparison.diff.summary.movedCount}</strong></span><span>Possible replacements <strong>{comparison.diff.summary.replacedCount}</strong></span></div>
            {comparison.diff.replacements.length > 0 && <details open><summary>Possible replacements</summary>{comparison.diff.replacements.map((item: any) => <p key={`${item.position}-${item.added.trackId}`}>Position {item.position}: <del>{item.removed.titleSnapshot} — {item.removed.artistSnapshot}</del> → <ins>{item.added.titleSnapshot} — {item.added.artistSnapshot}</ins></p>)}</details>}
            {comparison.diff.addedTracks.length > 0 && <details><summary>Added ({comparison.diff.addedTracks.length})</summary>{comparison.diff.addedTracks.map((track: any) => <p key={`a-${track.position}-${track.trackId}`}><strong>Added</strong> at {track.position}: {track.titleSnapshot} — {track.artistSnapshot}</p>)}</details>}
            {comparison.diff.removedTracks.length > 0 && <details><summary>Removed ({comparison.diff.removedTracks.length})</summary>{comparison.diff.removedTracks.map((track: any) => <p key={`r-${track.position}-${track.trackId}`}><strong>Removed</strong> from {track.position}: {track.titleSnapshot} — {track.artistSnapshot}</p>)}</details>}
            {comparison.diff.movedTracks.length > 0 && <details><summary>Moved ({comparison.diff.movedTracks.length})</summary>{comparison.diff.movedTracks.map((item: any) => <p key={`m-${item.track.trackId}`}>{item.track.titleSnapshot} moved from position {item.fromPosition} to {item.toPosition}</p>)}</details>}
            {comparison.diff.settingsChanges.length > 0 && <details><summary>Generation settings ({comparison.diff.settingsChanges.length})</summary>{comparison.diff.settingsChanges.map((item: any) => <p key={item.path}><strong>{item.group} · {item.label}</strong><br />{displayValue(item.from)} → {displayValue(item.to)}</p>)}</details>}
            {!comparison.diff.summary.addedCount && !comparison.diff.summary.removedCount && !comparison.diff.summary.movedCount && !comparison.diff.settingsChanges.length && <p>These versions are identical. No track, order, setting, or score differences were found.</p>}
          </section>}
          <details className={styles.trackSection}><summary>Historical track list ({detail.snapshot?.data.tracks.length || 0})</summary>{detail.snapshot?.data.tracks.map((track: any) => <article key={`${track.position}-${track.trackId}`}><span>{track.position}</span><div><strong>{track.titleSnapshot}</strong><p>{track.artistSnapshot || "Unknown artist"} · {track.albumSnapshot || "Unknown album"}</p><small>{track.durationMsSnapshot ? duration(track.durationMsSnapshot) : "Duration unavailable"} · BPM {track.bpmSnapshot ?? "—"} · Energy {track.energySnapshot ?? "—"}{track.moodSnapshot?.length ? ` · ${track.moodSnapshot.join(", ")}` : ""}</small>{track.availability !== "available" && <em>Track unavailable — this library item no longer exists.</em>}</div></article>)}</details>
          <div className={styles.footerActions}>{!selected.isCurrent && <button className={styles.deleteButton} onClick={removeVersion}><Trash2 size={15} /> Delete Version {selected.revisionNumber}</button>}</div>
        </>}
      </section>
    </div>}
    {restorePreview && selected && <div className={styles.modalBackdrop} role="presentation"><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="restore-title"><h3 id="restore-title">Restore Version {selected.revisionNumber}?</h3><p>This will update the current playlist to match Version {selected.revisionNumber}. A copy of the current state will be saved first.</p><div className={styles.changeStats}><span>Will add <strong>{restorePreview.diff.summary.removedCount}</strong></span><span>Will remove <strong>{restorePreview.diff.summary.addedCount}</strong></span><span>Will move <strong>{restorePreview.diff.summary.movedCount}</strong></span></div>{restorePreview.warning && <div className={styles.warning}>{restorePreview.warning}</div>}<label className={styles.check}><input type="checkbox" checked readOnly /> Restore generation settings</label><p>Playlist name will not be changed.</p><div className={styles.modalActions}><button onClick={() => setRestorePreview(null)}>Cancel</button><button className={styles.restoreButton} onClick={applyRestore} disabled={busy === "restore"}>{busy === "restore" ? "Restoring…" : restorePreview.missingTracks.length ? "Restore Available Tracks" : `Restore Version ${selected.revisionNumber}`}</button></div></section></div>}
  </main>;
}
