"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { AlertTriangle, BarChart3, CheckCircle2, GitCompareArrows, Grid3X3, RefreshCw, Shield, Sparkles, XCircle } from "lucide-react";
import styles from "./CrossPlaylistVarietyWorkspace.module.css";

const defaultGlobal = {
  maximumTrackOverlapPercent: 20, maximumArtistOverlapPercent: 35, maximumAlbumOverlapPercent: 25,
  maximumSharedTrackCount: null as number | null, minimumUniqueTrackPercent: 70, minimumUniqueTrackCount: null as number | null,
  recentUsageLookbackDays: 30 as number | null, recentUsagePenaltyStrength: "MEDIUM", sharedTrackAllowance: 0,
  coreTrackAllowance: null as number | null, exclusivityBehavior: "OFF", automaticRepairEnabled: false,
  requireRepairPreview: true, comparisonScope: "ALL_MANAGED", analysisConcurrency: 2, analysisBatchSize: 20,
};

const activeStatuses = new Set(["running", "processing", "retrying", "queued"]);
type Playlist = { id: string; plexPlaylistTitle: string; trackCount: number };
type Cell = { playlistAId: string; playlistBId: string; value: number; sharedTrackCount: number; track: number; artist: number; album: number; withinPolicy: boolean; stale: boolean; calculatedAt: string };

function intensity(value: number) {
  const alpha = Math.min(.85, .1 + value / 120);
  return value >= 40 ? `rgba(215,91,91,${alpha})` : value >= 20 ? `rgba(219,155,50,${alpha})` : `rgba(53,174,234,${alpha})`;
}

export default function CrossPlaylistVarietyWorkspace() {
  const [summary, setSummary] = useState<any>(null);
  const [settings, setSettings] = useState(defaultGlobal);
  const [heatmap, setHeatmap] = useState<{ playlists: Playlist[]; cells: Cell[]; pagination: any } | null>(null);
  const [mode, setMode] = useState("track");
  const [comparison, setComparison] = useState<any>(null);
  const [comparisonTab, setComparisonTab] = useState("overview");
  const [preview, setPreview] = useState<any>(null);
  const [selectedProposals, setSelectedProposals] = useState<Set<string>>(new Set());
  const [replacementSelections, setReplacementSelections] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [summaryResponse, settingsResponse, heatmapResponse] = await Promise.all([
        axios.get("/api/cross-playlist-variety/summary"),
        axios.get("/api/cross-playlist-variety/settings"),
        axios.get(`/api/cross-playlist-variety/heatmap?mode=${mode}&limit=25`),
      ]);
      setSummary(summaryResponse.data);
      setSettings({ ...defaultGlobal, ...settingsResponse.data.settings });
      setHeatmap(heatmapResponse.data);
    } catch (caught: any) { setError(caught.response?.data?.error || "Failed to load cross-playlist variety data."); }
  }, [mode]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const job = summary?.analysis;
    if (!job?.id || !activeStatuses.has(String(job.status).toLowerCase())) return;
    const timer = window.setInterval(async () => {
      const response = await axios.get(`/api/cross-playlist-variety/analysis?jobId=${job.id}`).catch(() => null);
      if (response) {
        setSummary((current: any) => ({ ...current, analysis: response.data.job }));
        if (!activeStatuses.has(String(response.data.job.status).toLowerCase())) { window.clearInterval(timer); await load(); }
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [summary?.analysis, load]);

  const playlistById = useMemo(() => new Map((heatmap?.playlists || []).map((playlist) => [playlist.id, playlist])), [heatmap]);
  const cellByPair = useMemo(() => new Map((heatmap?.cells || []).map((cell) => [[cell.playlistAId, cell.playlistBId].sort().join(":"), cell])), [heatmap]);
  const ranked = useMemo(() => [...(heatmap?.cells || [])].sort((left, right) => right.value - left.value), [heatmap]);

  async function saveSettings() {
    setBusy(true); setError(""); setMessage("");
    try { await axios.put("/api/cross-playlist-variety/settings", settings); setMessage("Cross-playlist defaults saved. Existing playlists were not modified; analysis was marked stale."); await load(); }
    catch (caught: any) { setError(caught.response?.data?.error || "Failed to save variety settings."); }
    finally { setBusy(false); }
  }

  async function startAnalysis(retry = false) {
    setBusy(true); setError(""); setMessage("");
    try { const response = await axios.post("/api/cross-playlist-variety/analysis", { retry, batchSize: settings.analysisBatchSize }); setSummary((current: any) => ({ ...current, analysis: response.data.job })); setMessage("Analysis started in the background. You can keep using Mixarr."); }
    catch (caught: any) { setError(caught.response?.data?.error || "Failed to start analysis."); }
    finally { setBusy(false); }
  }

  async function cancelAnalysis() {
    if (!summary?.analysis?.id) return;
    setBusy(true);
    try { await axios.delete(`/api/cross-playlist-variety/analysis?jobId=${summary.analysis.id}`); setMessage("Analysis cancelled. Completed pair results remain available."); await load(); }
    catch (caught: any) { setError(caught.response?.data?.error || "Failed to cancel analysis."); }
    finally { setBusy(false); }
  }

  async function openComparison(playlistAId: string, playlistBId: string) {
    setBusy(true); setError(""); setPreview(null); setComparisonTab("overview");
    try { const response = await axios.get(`/api/cross-playlist-variety/compare?playlistAId=${playlistAId}&playlistBId=${playlistBId}`); setComparison(response.data.comparison); }
    catch (caught: any) { setError(caught.response?.data?.error || "Failed to compare playlists."); }
    finally { setBusy(false); }
  }

  async function designate(trackId: string, update: { isCore?: boolean; isSharedAllowed?: boolean }) {
    if (!comparison) return;
    setBusy(true);
    try { await axios.patch(`/api/playlists/${comparison.sourcePlaylist.id}/variety-designations`, { trackIds: [trackId], ...update }); setMessage(update.isCore ? "Track marked as core and protected from repair." : "Shared-track allowance saved."); await openComparison(comparison.sourcePlaylist.id, comparison.targetPlaylist.id); }
    catch (caught: any) { setError(caught.response?.data?.error || "Failed to update track designation."); }
    finally { setBusy(false); }
  }

  async function ignorePair() {
    await updatePairPolicy({ ignored: true }, "This pair is excluded from enforcement but remains visible in reports.");
  }

  async function updatePairPolicy(update: Record<string, unknown>, successMessage: string) {
    if (!comparison) return;
    setBusy(true); setError("");
    try {
      const ids = { playlistAId: comparison.sourcePlaylist.id, playlistBId: comparison.targetPlaylist.id };
      const current = (await axios.get("/api/cross-playlist-variety/pair-policy", { params: ids })).data.policy || {};
      await axios.put("/api/cross-playlist-variety/pair-policy", {
        ...ids,
        ignored: current.ignored || false,
        allowedTrackOverlapPercent: current.allowedTrackOverlapPercent,
        allowedArtistOverlapPercent: current.allowedArtistOverlapPercent,
        allowedAlbumOverlapPercent: current.allowedAlbumOverlapPercent,
        maximumSharedTrackCount: current.maximumSharedTrackCount,
        sharedTrackAllowance: current.sharedTrackAllowance,
        allowedArtistIds: current.allowedArtistIdsJson || [],
        allowedAlbumIds: current.allowedAlbumIdsJson || [],
        similarPlaylistAllowance: current.similarPlaylistAllowance || false,
        notes: current.notes,
        ...update,
      });
      setMessage(successMessage);
      await openComparison(ids.playlistAId, ids.playlistBId);
    } catch (caught: any) { setError(caught.response?.data?.error || "Failed to update playlist-pair policy."); }
    finally { setBusy(false); }
  }

  async function allowPairEntity(kind: "artist" | "album", key: string) {
    const match = key.match(kind === "artist" ? /^artist:([0-9a-f-]{36})$/i : /^album:([0-9a-f-]{36})$/i);
    if (!match || !comparison) return;
    const existing = kind === "artist" ? comparison.policy.allowedArtistIds : comparison.policy.allowedAlbumIds;
    await updatePairPolicy(
      { [kind === "artist" ? "allowedArtistIds" : "allowedAlbumIds"]: Array.from(new Set([...(existing || []), match[1]])) },
      `${kind === "artist" ? "Artist" : "Album"} allowed for this playlist pair.`,
    );
  }

  async function buildRepairPreview() {
    if (!comparison) return;
    setBusy(true); setError("");
    try {
      const response = await axios.post("/api/cross-playlist-variety/repair/preview", { playlistId: comparison.sourcePlaylist.id, comparisonPlaylistId: comparison.targetPlaylist.id, mode: "ALL" });
      setPreview(response.data.preview); setSelectedProposals(new Set(response.data.preview.proposals.map((proposal: any) => proposal.id))); setReplacementSelections({}); setComparisonTab("repair");
    } catch (caught: any) { setError(caught.response?.data?.error || "Failed to build repair preview."); }
    finally { setBusy(false); }
  }

  async function applyRepair() {
    if (!preview || !selectedProposals.size) return;
    setBusy(true); setError("");
    try { await axios.post("/api/cross-playlist-variety/repair/apply", { previewId: preview.previewId, proposalIds: Array.from(selectedProposals), replacementSelections, confirm: true }); setMessage("Selected replacements applied. A restorable playlist version was created."); setPreview(null); await load(); await openComparison(comparison.sourcePlaylist.id, comparison.targetPlaylist.id); }
    catch (caught: any) { setError(caught.response?.data?.error || "Failed to apply repair."); }
    finally { setBusy(false); }
  }

  const progress = summary?.analysis?.progress || {};
  const analysisActive = activeStatuses.has(String(summary?.analysis?.status || "").toLowerCase());

  return <>
    <section className={styles.hero} aria-labelledby="variety-heading">
      <div><span className={styles.kicker}><Grid3X3 size={14} /> v2.2.2</span><h3 id="variety-heading">Cross-Playlist Deduplication &amp; Variety</h3><p>Find unhealthy track, artist, and album concentration while keeping intentional shared music, core tracks, and playlist identity intact.</p></div>
      <div className={styles.actions}><button disabled={busy || analysisActive} onClick={() => startAnalysis(summary?.analysis?.status === "failed")}><RefreshCw size={15} /> {summary?.analysis?.status === "failed" ? "Retry analysis" : "Analyze playlists"}</button>{analysisActive && <button onClick={cancelAnalysis}><XCircle size={15} /> Cancel</button>}</div>
    </section>
    {error && <div className={styles.error}><AlertTriangle size={16} /> {error}</div>}
    {message && <div className={styles.success}><CheckCircle2 size={16} /> {message}</div>}

    <section className={styles.summaryCards} aria-label="Cross-playlist health summary">
      <article><span>Managed playlists</span><strong>{summary?.summary?.managedPlaylists || 0}</strong></article>
      <article><span>Average track overlap</span><strong>{summary?.summary?.averageTrackOverlap || 0}%</strong></article>
      <article><span>Pairs above limit</span><strong>{summary?.summary?.pairsAboveLimit || 0}</strong></article>
      <article><span>Repair suggestions</span><strong>{summary?.pairs?.reduce((sum: number, pair: any) => sum + (pair.excessSharedTrackCount || 0), 0) || 0}</strong></article>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHeader}><div><h4>Analysis status</h4><p>Pair calculations are cached. Playlist changes mark only related results stale.</p></div><span className={styles.status}>{String(summary?.analysis?.status || "Analysis required").replaceAll("_", " ")}</span></div>
      {analysisActive ? <div><div className={styles.progress}><span style={{ width: `${Math.round(((progress.playlistPairsProcessed || 0) / Math.max(1, progress.playlistPairsTotal || 1)) * 100)}%` }} /></div><p className={styles.muted}>{progress.playlistPairsProcessed || 0} / {progress.playlistPairsTotal || 0} pairs · {progress.tracksEvaluated || 0} track memberships evaluated · {progress.pairsAboveLimit || 0} above limit</p></div> : <p className={styles.muted}>{summary?.analysis?.summary || "Analysis required. Existing playlist generation remains available."}</p>}
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHeader}><div><h4>Global Smart Mix defaults</h4><p>Playlist and playlist-pair overrides show their inheritance source in comparison details.</p></div><button disabled={busy} onClick={saveSettings}>Save defaults</button></div>
      <div className={styles.settingsGrid}>
        <label>Maximum track overlap <strong>{settings.maximumTrackOverlapPercent}%</strong><input type="range" min="0" max="100" value={settings.maximumTrackOverlapPercent} onChange={(event) => setSettings({ ...settings, maximumTrackOverlapPercent: Number(event.target.value) })} /></label>
        <label>Maximum artist overlap <strong>{settings.maximumArtistOverlapPercent}%</strong><input type="range" min="0" max="100" value={settings.maximumArtistOverlapPercent} onChange={(event) => setSettings({ ...settings, maximumArtistOverlapPercent: Number(event.target.value) })} /></label>
        <label>Maximum album overlap <strong>{settings.maximumAlbumOverlapPercent}%</strong><input type="range" min="0" max="100" value={settings.maximumAlbumOverlapPercent} onChange={(event) => setSettings({ ...settings, maximumAlbumOverlapPercent: Number(event.target.value) })} /></label>
        <label>Minimum unique tracks <strong>{settings.minimumUniqueTrackPercent}%</strong><input type="range" min="0" max="100" value={settings.minimumUniqueTrackPercent} onChange={(event) => setSettings({ ...settings, minimumUniqueTrackPercent: Number(event.target.value) })} /></label>
        <label>Recently used penalty<select value={settings.recentUsagePenaltyStrength} onChange={(event) => setSettings({ ...settings, recentUsagePenaltyStrength: event.target.value })}><option>OFF</option><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>STRICT</option></select></label>
        <label>Lookback<select value={settings.recentUsageLookbackDays ?? "all"} onChange={(event) => setSettings({ ...settings, recentUsageLookbackDays: event.target.value === "all" ? null : Number(event.target.value) })}><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option><option value="all">All time</option></select></label>
        <label className={styles.toggle}><input type="checkbox" checked={settings.automaticRepairEnabled} onChange={(event) => setSettings({ ...settings, automaticRepairEnabled: event.target.checked })} /><span><strong>Automatic repair</strong><small>Disabled by default. Preview remains required unless explicitly changed.</small></span></label>
        <label className={styles.toggle}><input type="checkbox" checked={settings.requireRepairPreview} onChange={(event) => setSettings({ ...settings, requireRepairPreview: event.target.checked })} /><span><strong>Require preview</strong><small>Every replacement remains selectable and no preview changes a playlist.</small></span></label>
      </div>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHeader}><div><h4>Overlap heatmap</h4><p>Color is paired with an exact percentage and accessible label. Select a cell to compare playlists.</p></div><div className={styles.modeTabs}>{["track", "artist", "album"].map((item) => <button className={mode === item ? styles.activeTab : ""} key={item} onClick={() => setMode(item)}>{item}</button>)}</div></div>
      {!heatmap?.cells.length ? <div className={styles.empty}><BarChart3 size={24} /><strong>Analysis required</strong><span>Run the background analysis to populate pairwise overlap.</span></div> : <>
        <div className={styles.matrix} style={{ gridTemplateColumns: `minmax(120px,1.5fr) repeat(${heatmap.playlists.length},minmax(38px,1fr))` }}>
          <span />{heatmap.playlists.map((playlist, index) => <span className={styles.axisTop} key={playlist.id} title={playlist.plexPlaylistTitle}>{index + 1}</span>)}
          {heatmap.playlists.flatMap((row, rowIndex) => [<span className={styles.axisSide} key={`${row.id}-label`}>{rowIndex + 1}. {row.plexPlaylistTitle}</span>, ...heatmap.playlists.map((column) => {
            if (row.id === column.id) return <span className={styles.selfCell} key={`${row.id}:${column.id}`}>—</span>;
            const cell = cellByPair.get([row.id, column.id].sort().join(":"));
            return <button key={`${row.id}:${column.id}`} disabled={!cell} className={styles.heatCell} style={cell ? { background: intensity(cell.value) } : undefined} title={cell ? `${row.plexPlaylistTitle} and ${column.plexPlaylistTitle}: ${cell.value}% ${mode} overlap${cell.stale ? " (stale)" : ""}` : "Not analyzed"} aria-label={cell ? `Compare ${row.plexPlaylistTitle} and ${column.plexPlaylistTitle}, ${cell.value} percent ${mode} overlap` : `${row.plexPlaylistTitle} and ${column.plexPlaylistTitle} not analyzed`} onClick={() => cell && openComparison(row.id, column.id)}>{cell ? `${cell.value}%` : "·"}</button>;
          })])}
        </div>
        <div className={styles.mobileRanked}>{ranked.map((cell) => <button key={`${cell.playlistAId}:${cell.playlistBId}`} onClick={() => openComparison(cell.playlistAId, cell.playlistBId)}><span>{playlistById.get(cell.playlistAId)?.plexPlaylistTitle} ↔ {playlistById.get(cell.playlistBId)?.plexPlaylistTitle}</span><strong>{cell.value}%</strong><small>{cell.sharedTrackCount} shared tracks{cell.stale ? " · stale" : ""}</small></button>)}</div>
      </>}
    </section>

    {comparison && <section className={styles.comparison} aria-label="Playlist comparison">
      <div className={styles.panelHeader}><div><span className={styles.kicker}><GitCompareArrows size={14} /> Playlist comparison</span><h4>{comparison.sourcePlaylist.plexPlaylistTitle} ↔ {comparison.targetPlaylist.plexPlaylistTitle}</h4><p>{comparison.sharedTrackPercentage}% of the smaller playlist is shared. Target maximum: {comparison.policy.maximumTrackOverlapPercent}%.</p></div><button onClick={() => setComparison(null)}>Close</button></div>
      <div className={styles.warningRow}>{comparison.warnings.map((warning: any) => <span key={warning.code} data-level={warning.level}><AlertTriangle size={14} /> {warning.message}</span>)}</div>
      <div className={styles.tabs}>{["overview", "shared", "artists", "albums", "unique-a", "unique-b", "repair", "history"].map((tab) => <button className={comparisonTab === tab ? styles.activeTab : ""} key={tab} onClick={() => setComparisonTab(tab)}>{tab.replace("unique-a", `Unique to ${comparison.sourcePlaylist.plexPlaylistTitle}`).replace("unique-b", `Unique to ${comparison.targetPlaylist.plexPlaylistTitle}`)}</button>)}</div>
      {comparisonTab === "overview" && <div className={styles.metrics}>
        <article><span>Shared tracks</span><strong>{comparison.sharedTrackCount}</strong><small>{comparison.sharedTrackPercentage}% of smaller · {comparison.overlapPercentOfSource}% of A · {comparison.overlapPercentOfTarget}% of B</small></article>
        <article><span>Unique tracks</span><strong>{comparison.sourceUniqueTrackPercentage}% / {comparison.targetUniqueTrackPercentage}%</strong><small>{comparison.sourceUniqueTrackCount} in A · {comparison.targetUniqueTrackCount} in B</small></article>
        <article><span>Shared artists</span><strong>{comparison.sharedArtistPercentage}%</strong><small>{comparison.tracksFromSharedArtists} tracks from overlapping artists</small></article>
        <article><span>Shared albums</span><strong>{comparison.sharedAlbumPercentage}%</strong><small>{comparison.dominatingAlbumKeys.length} dominating albums</small></article>
        <article><span>Current policy</span><strong>{comparison.withinPolicy ? "Within policy" : `${comparison.excessSharedTrackCount} replacements suggested`}</strong><small>{comparison.policy.sources.playlist} {comparison.policy.sources.pair ? `· ${comparison.policy.sources.pair}` : ""}</small></article>
        <article><span>Safety</span><strong>Preview required</strong><small>Core, locked, liked, protected, and manual tracks are preserved by default.</small></article>
      </div>}
      {comparisonTab === "shared" && <div className={styles.trackList}>{comparison.sharedTracks.map((track: any) => <article key={track.key}><div><strong>{track.title}</strong><span>{track.artist || "Unknown artist"} · {track.album || "Album unavailable"}</span></div><div>{track.core && <em>Core</em>}{track.sharedAllowed && <em>Allowed</em>}<button disabled={busy || track.core} onClick={() => designate(track.trackId, { isCore: true })}><Sparkles size={13} /> Core</button><button disabled={busy || track.sharedAllowed} onClick={() => designate(track.trackId, { isSharedAllowed: true })}><Shield size={13} /> Allow share</button></div></article>)}</div>}
      {comparisonTab === "artists" && <div className={styles.rankList}>{comparison.mostRepeatedArtists.map((artist: any) => <p key={artist.key}><span>{artist.key.replace(/^artist(-name)?:/, "")}</span><strong>{artist.count} tracks</strong>{/^artist:[0-9a-f-]{36}$/i.test(artist.key) && <button disabled={busy || comparison.policy.allowedArtistIds?.includes(artist.key.slice(7))} onClick={() => allowPairEntity("artist", artist.key)}>Allow for pair</button>}</p>)}</div>}
      {comparisonTab === "albums" && <div className={styles.rankList}>{comparison.mostRepeatedAlbums.map((album: any) => <p key={album.key}><span>{album.key.replace(/^(album|album-name|compilation):/, "")}</span><strong>{album.count} tracks</strong>{/^album:[0-9a-f-]{36}$/i.test(album.key) && <button disabled={busy || comparison.policy.allowedAlbumIds?.includes(album.key.slice(6))} onClick={() => allowPairEntity("album", album.key)}>Allow for pair</button>}</p>)}</div>}
      {comparisonTab === "unique-a" && <div className={styles.trackList}>{comparison.sourceUniqueTracks.map((track: any) => <article key={track.key}><div><strong>{track.title}</strong><span>{track.artist}</span></div></article>)}</div>}
      {comparisonTab === "unique-b" && <div className={styles.trackList}>{comparison.targetUniqueTracks.map((track: any) => <article key={track.key}><div><strong>{track.title}</strong><span>{track.artist}</span></div></article>)}</div>}
      {comparisonTab === "repair" && <div>{!preview ? <div className={styles.repairIntro}><p>Generate deterministic suggestions without changing either playlist.</p><button disabled={busy || comparison.withinPolicy} onClick={buildRepairPreview}>Preview replacements</button><button disabled={busy} onClick={ignorePair}>Ignore this playlist pair</button></div> : <><div className={styles.beforeAfter}><span>Track overlap <strong>{preview.before.track}% → {preview.after.track}%</strong></span><span>Artist overlap <strong>{preview.before.artist}% → {preview.after.artist}%</strong></span><span>Album overlap <strong>{preview.before.album}% → {preview.after.album}%</strong></span></div>{preview.proposals.map((proposal: any) => <label className={styles.proposal} key={proposal.id}><input type="checkbox" checked={selectedProposals.has(proposal.id)} onChange={(event) => setSelectedProposals((current) => { const next = new Set(current); event.target.checked ? next.add(proposal.id) : next.delete(proposal.id); return next; })} /><div><strong>Remove: {proposal.remove.title} — {proposal.remove.artist}</strong><p>{proposal.reasons.remove}</p><strong>Replace with: {proposal.replacement.title} — {proposal.replacement.artist}</strong>{proposal.alternatives?.length > 0 && <select aria-label={`Replacement for ${proposal.remove.title}`} value={replacementSelections[proposal.id] || proposal.replacement.trackId} onChange={(event) => setReplacementSelections((current) => ({ ...current, [proposal.id]: event.target.value }))}><option value={proposal.replacement.trackId}>{proposal.replacement.title} — {proposal.replacement.artist}</option>{proposal.alternatives.map((alternative: any) => <option key={alternative.trackId} value={alternative.trackId}>{alternative.title} — {alternative.artist}</option>)}</select>}<p>{proposal.reasons.replacement}</p><small>Score {proposal.impact.score >= 0 ? "+" : ""}{proposal.impact.score} · {proposal.impact.mood} · {proposal.impact.bpmFlow}</small></div></label>)}{preview.relaxedConstraints.map((item: string) => <p className={styles.relaxed} key={item}>{item}</p>)}<div className={styles.actions}><button disabled={busy || !selectedProposals.size} onClick={applyRepair}>Apply selected replacements</button><button onClick={() => setPreview(null)}>Reject all</button></div></>}</div>}
      {comparisonTab === "history" && <div className={styles.history}>{!comparison.history.length ? <p>No historical snapshots yet.</p> : comparison.history.map((point: any) => <div key={point.id}><span>{new Date(point.calculatedAt).toLocaleString()}</span><strong>{point.sharedTrackPercentage}% tracks</strong><span>{point.sharedArtistPercentage}% artists · {point.sharedAlbumPercentage}% albums</span></div>)}</div>}
    </section>}
  </>;
}
