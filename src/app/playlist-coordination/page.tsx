"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { AlertTriangle, ArrowRight, CheckCircle2, GitCompareArrows, Link2, Network, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import styles from "./playlist-coordination.module.css";

type Playlist = { id: string; plexPlaylistTitle: string; trackCount: number; engineVersion?: string };
type Pair = { relationshipId: string; relationshipType: string; playlistA: Playlist; playlistB: Playlist; sharedTrackCount: number; sharedTrackPercentage: number; sharedArtistCount: number; sharedArtistPercentage: number; sharedAlbumCount: number; sharedAlbumPercentage: number; sharedCoreTrackCount: number; jaccardSimilarity: number; similarityScore: number; limit: number; status: string };
type Dashboard = { summary: { coordinatedPlaylists: number; relationships: number; highOverlapPairs: number; duplicateTracks: number; sharedCoreTracks: number; progressionChains: number; overlapWarnings: number }; pairs: Pair[] };
type Settings = { coordinationEnabled: boolean; maximumSharedTrackPercentage: number; overlapEnforcement: string; keepDistinct: boolean; allowSharedCoreTracks: boolean; maximumSharedCoreTracks?: number | null; preferGloballyUnusedTracks: boolean; unusedTrackPreferenceStrength: number; maximumCoordinationInfluence: number; crossPlaylistArtistBalancingEnabled: boolean; maximumSharedArtistPercentage?: number | null; maximumTracksPerArtistAcrossGroup?: number | null; featuredArtistMatching: string; warnBeforeExceedingOverlap: boolean; excludedPlaylistIds: string[] };

const defaultSettings: Settings = { coordinationEnabled: false, maximumSharedTrackPercentage: 20, overlapEnforcement: "SOFT_TARGET", keepDistinct: false, allowSharedCoreTracks: false, maximumSharedCoreTracks: null, preferGloballyUnusedTracks: false, unusedTrackPreferenceStrength: 0.5, maximumCoordinationInfluence: 12, crossPlaylistArtistBalancingEnabled: true, maximumSharedArtistPercentage: 40, maximumTracksPerArtistAcrossGroup: 6, featuredArtistMatching: "PRIMARY_ONLY", warnBeforeExceedingOverlap: true, excludedPlaylistIds: [] };

function statusClass(status: string) {
  if (status === "Healthy") return styles.healthy;
  if (status === "Near limit") return styles.near;
  if (status === "Over limit") return styles.over;
  return styles.disabled;
}

export default function PlaylistCoordinationPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [chains, setChains] = useState<any[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [relationshipType, setRelationshipType] = useState("SISTER");
  const [preset, setPreset] = useState("DISTINCT_VARIATIONS");
  const [settingsPlaylistId, setSettingsPlaylistId] = useState("");
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [chainName, setChainName] = useState("");
  const [chainMembers, setChainMembers] = useState<string[]>([]);
  const [sourceTracks, setSourceTracks] = useState<any[]>([]);
  const [moveTrackId, setMoveTrackId] = useState("");
  const [moveTargetId, setMoveTargetId] = useState("");
  const [moveMode, setMoveMode] = useState("MOVE");
  const [movePreview, setMovePreview] = useState<any | null>(null);
  const [rebalancePreview, setRebalancePreview] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [dashboardResponse, playlistResponse, chainResponse] = await Promise.all([
        axios.get("/api/playlist-coordination/dashboard"),
        axios.get("/api/generated-playlists"),
        axios.get("/api/playlist-coordination/progressions"),
      ]);
      setDashboard(dashboardResponse.data);
      setPlaylists(playlistResponse.data.playlists || []);
      setChains(chainResponse.data.chains || []);
      const firstId = playlistResponse.data.playlists?.[0]?.id || "";
      setSourceId((current) => current || firstId);
      setSettingsPlaylistId((current) => current || firstId);
    } catch (caught: any) { setError(caught.response?.data?.error || "Failed to load playlist coordination."); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!settingsPlaylistId) return;
    axios.get(`/api/playlists/${settingsPlaylistId}/coordination`).then((response) => setSettings({ ...defaultSettings, ...response.data.settings })).catch((caught) => setError(caught.response?.data?.error || "Failed to load playlist settings."));
  }, [settingsPlaylistId]);
  useEffect(() => {
    if (!sourceId) return setSourceTracks([]);
    axios.get(`/api/generated-playlists/${sourceId}`).then((response) => setSourceTracks(response.data.playlist?.tracks || [])).catch(() => setSourceTracks([]));
    setMoveTrackId(""); setMovePreview(null);
  }, [sourceId]);

  const targetOptions = useMemo(() => playlists.filter((playlist) => playlist.id !== sourceId), [playlists, sourceId]);
  const moveTargetOptions = useMemo(() => {
    const relatedIds = new Set((dashboard?.pairs || []).flatMap((pair) => pair.playlistA.id === sourceId ? [pair.playlistB.id] : pair.playlistB.id === sourceId ? [pair.playlistA.id] : []));
    return playlists.filter((playlist) => relatedIds.has(playlist.id));
  }, [dashboard, playlists, sourceId]);

  async function createRelationship() {
    if (!sourceId || !targetId) return setError("Choose two different playlists.");
    setBusy(true); setError(""); setMessage("");
    try {
      const presetValues: Record<string, any> = {
        CLOSELY_RELATED: { sharedCoreAllowed: true, maximumSharedTrackPercentage: 35, maximumSharedArtistPercentage: 60 },
        DISTINCT_VARIATIONS: { sharedCoreAllowed: true, maximumSharedTrackPercentage: 20, maximumSharedArtistPercentage: 40 },
        COMPANION_PLAYLISTS: { sharedCoreAllowed: false, maximumSharedTrackPercentage: 10, maximumSharedArtistPercentage: 30 },
        FULLY_DISTINCT: { sharedCoreAllowed: false, maximumSharedTrackPercentage: 0, maximumSharedArtistPercentage: 15 },
      };
      await axios.post(`/api/playlists/${sourceId}/relationships`, { targetPlaylistId: targetId, relationshipType, preset, ...presetValues[preset] });
      setMessage("Playlist relationship created. Coordination changes affect future previews and regeneration; Plex was not modified.");
      await load();
    } catch (caught: any) { setError(caught.response?.data?.error || "Failed to create relationship."); }
    finally { setBusy(false); }
  }

  async function saveSettings() {
    setBusy(true); setError(""); setMessage("");
    try {
      await axios.patch(`/api/playlists/${settingsPlaylistId}/coordination`, settings);
      setMessage("Coordination settings saved. Existing playlist tracks were left unchanged.");
      await load();
    } catch (caught: any) { setError(caught.response?.data?.error || "Failed to save coordination settings."); }
    finally { setBusy(false); }
  }

  async function createChain() {
    if (!chainName.trim() || chainMembers.length < 2) return setError("Name the chain and select at least two playlists in sequence.");
    setBusy(true); setError("");
    try {
      await axios.post("/api/playlist-coordination/progressions", { name: chainName, members: chainMembers.map((playlistId) => ({ playlistId, handoffBehavior: "SMOOTH" })) });
      setChainName(""); setChainMembers([]); setMessage("Progression chain created."); await load();
    } catch (caught: any) { setError(caught.response?.data?.error || "Failed to create progression chain."); }
    finally { setBusy(false); }
  }

  async function previewMove() {
    if (!sourceId || !moveTargetId || !moveTrackId) return setError("Choose a source track and related target playlist.");
    setBusy(true); setError("");
    try { const response = await axios.post(`/api/playlists/${sourceId}/move-track/preview`, { trackId: moveTrackId, targetPlaylistId: moveTargetId, mode: moveMode, preserveSourceLength: true }); setMovePreview(response.data.preview); }
    catch (caught: any) { setError(caught.response?.data?.error || "Failed to preview track move."); }
    finally { setBusy(false); }
  }

  async function applyMove() {
    setBusy(true); setError("");
    try { await axios.post(`/api/playlists/${sourceId}/move-track/apply`, { trackId: moveTrackId, targetPlaylistId: moveTargetId, mode: moveMode, preserveSourceLength: true, confirm: true }); setMovePreview(null); setMessage("Confirmed track action applied to Mixarr and synchronized to Plex."); await load(); }
    catch (caught: any) { setError(caught.response?.data?.error || "Failed to apply track move."); }
    finally { setBusy(false); }
  }

  async function previewRebalance() {
    setBusy(true); setError("");
    try { const response = await axios.post("/api/playlist-coordination/rebalance/preview", {}); setRebalancePreview(response.data); }
    catch (caught: any) { setError(caught.response?.data?.error || "Failed to preview rebalance."); }
    finally { setBusy(false); }
  }

  async function markSharedCore(shared: boolean) {
    if (!moveTrackId) return;
    setBusy(true); setError("");
    try { await axios.post(`/api/playlists/${sourceId}/shared-core`, { trackIds: [moveTrackId], shared }); setMessage(shared ? "Track marked as shared core." : "Shared-core status removed."); await load(); }
    catch (caught: any) { setError(caught.response?.data?.error || "Failed to update shared-core status."); }
    finally { setBusy(false); }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><span className={styles.kicker}><Network size={14} /> Smart Mix</span><h2>Playlist Coordination</h2><p>Keep related playlists recognizable without letting the same safe tracks, artists, and albums take over every mix.</p></div>
        <button className={styles.secondaryButton} onClick={load}><RefreshCw size={16} /> Refresh</button>
      </header>
      {error && <div className={styles.error}><AlertTriangle size={17} /> {error}</div>}
      {message && <div className={styles.success}><CheckCircle2 size={17} /> {message}</div>}

      <section className={styles.cards} aria-label="Coordination summary">
        {[
          ["Coordinated playlists", dashboard?.summary.coordinatedPlaylists || 0, Link2],
          ["Relationships", dashboard?.summary.relationships || 0, Network],
          ["High-overlap pairs", dashboard?.summary.highOverlapPairs || 0, AlertTriangle],
          ["Duplicate tracks", dashboard?.summary.duplicateTracks || 0, GitCompareArrows],
          ["Shared core tracks", dashboard?.summary.sharedCoreTracks || 0, Sparkles],
          ["Progression chains", dashboard?.summary.progressionChains || 0, ArrowRight],
          ["Warnings", dashboard?.summary.overlapWarnings || 0, ShieldCheck],
        ].map(([label, value, Icon]: any) => <article className={styles.card} key={label}><Icon size={18} /><span>{label}</span><strong>{value}</strong></article>)}
      </section>

      <div className={styles.twoColumn}>
        <section className={styles.panel}><div className={styles.panelHeader}><div><h3>Add relationship</h3><p>Presets provide editable starting values.</p></div></div>
          <div className={styles.formGrid}>
            <label>Playlist A<select value={sourceId} onChange={(event) => { setSourceId(event.target.value); setTargetId(""); }}>{playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.plexPlaylistTitle}</option>)}</select></label>
            <label>Playlist B<select value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">Select playlist</option>{targetOptions.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.plexPlaylistTitle}</option>)}</select></label>
            <label>Relationship<select value={relationshipType} onChange={(event) => setRelationshipType(event.target.value)}><option value="SISTER">Sister playlists</option><option value="RELATED">Related</option><option value="DISTINCT_FROM">Distinct from</option><option value="PARENT">Parent</option><option value="CHILD">Child</option></select></label>
            <label>Preset<select value={preset} onChange={(event) => setPreset(event.target.value)}><option value="CLOSELY_RELATED">Closely Related</option><option value="DISTINCT_VARIATIONS">Distinct Variations</option><option value="COMPANION_PLAYLISTS">Companion Playlists</option><option value="FULLY_DISTINCT">Fully Distinct</option></select></label>
          </div><button className={styles.primaryButton} disabled={busy || !targetId} onClick={createRelationship}><Link2 size={16} /> Add relationship</button>
        </section>

        <section className={styles.panel}><div className={styles.panelHeader}><div><h3>Progression chains</h3><p>Select playlists in playback-handoff order.</p></div></div>
          <label className={styles.fullLabel}>Chain name<input value={chainName} onChange={(event) => setChainName(event.target.value)} placeholder="Warm-Up to Cooldown" /></label>
          <div className={styles.memberPicker}>{playlists.map((playlist) => <button key={playlist.id} type="button" className={chainMembers.includes(playlist.id) ? styles.selectedMember : ""} onClick={() => setChainMembers((current) => current.includes(playlist.id) ? current.filter((id) => id !== playlist.id) : current.concat(playlist.id))}>{chainMembers.indexOf(playlist.id) >= 0 ? `${chainMembers.indexOf(playlist.id) + 1}. ` : ""}{playlist.plexPlaylistTitle}</button>)}</div>
          <button className={styles.primaryButton} disabled={busy || chainMembers.length < 2} onClick={createChain}><ArrowRight size={16} /> Create chain</button>
          {chains.map((chain) => <div className={styles.chain} key={chain.id}><strong>{chain.name}</strong><p>{chain.members.map((member: any) => member.playlist.plexPlaylistTitle).join(" → ")}</p></div>)}
        </section>
      </div>

      <section className={styles.panel}><div className={styles.panelHeader}><div><h3>Playlist settings</h3><p>Coordination is conservative and disabled for legacy playlists until you enable it.</p></div><select value={settingsPlaylistId} onChange={(event) => setSettingsPlaylistId(event.target.value)}>{playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.plexPlaylistTitle}</option>)}</select></div>
        <div className={styles.settingsGrid}>
          <label className={styles.toggle}><input type="checkbox" checked={settings.coordinationEnabled} onChange={(event) => setSettings({ ...settings, coordinationEnabled: event.target.checked })} /><span><strong>Coordinate with related playlists</strong><small>Apply relationship-aware scoring during generation and regeneration.</small></span></label>
          <label>Overlap enforcement<select value={settings.overlapEnforcement} onChange={(event) => setSettings({ ...settings, overlapEnforcement: event.target.value })}><option value="OFF">Off</option><option value="WARNING_ONLY">Warning only</option><option value="SOFT_TARGET">Soft target</option><option value="HARD_MAXIMUM">Hard maximum</option></select></label>
          <label>Maximum shared tracks <strong>{settings.maximumSharedTrackPercentage}%</strong><input type="range" min="0" max="100" value={settings.maximumSharedTrackPercentage} onChange={(event) => setSettings({ ...settings, maximumSharedTrackPercentage: Number(event.target.value) })} /></label>
          <label>Unused-track preference <strong>{Math.round(settings.unusedTrackPreferenceStrength * 100)}%</strong><input type="range" min="0" max="1" step="0.05" value={settings.unusedTrackPreferenceStrength} onChange={(event) => setSettings({ ...settings, unusedTrackPreferenceStrength: Number(event.target.value) })} /></label>
          <label className={styles.toggle}><input type="checkbox" checked={settings.keepDistinct} onChange={(event) => setSettings({ ...settings, keepDistinct: event.target.checked })} /><span><strong>Keep playlists distinct</strong><small>Also penalize repeated artists and albums.</small></span></label>
          <label className={styles.toggle}><input type="checkbox" checked={settings.allowSharedCoreTracks} onChange={(event) => setSettings({ ...settings, allowSharedCoreTracks: event.target.checked })} /><span><strong>Allow shared core</strong><small>Intentional shared tracks bypass overlap penalties, not safety rules.</small></span></label>
          <label className={styles.toggle}><input type="checkbox" checked={settings.preferGloballyUnusedTracks} onChange={(event) => setSettings({ ...settings, preferGloballyUnusedTracks: event.target.checked })} /><span><strong>Prefer globally unused tracks</strong><small>A bounded bonus, never a hard eligibility rule.</small></span></label>
          <label className={styles.toggle}><input type="checkbox" checked={settings.crossPlaylistArtistBalancingEnabled} onChange={(event) => setSettings({ ...settings, crossPlaylistArtistBalancingEnabled: event.target.checked })} /><span><strong>Balance artists across the group</strong><small>Locked tracks remain protected.</small></span></label>
        </div><button className={styles.primaryButton} disabled={busy || !settingsPlaylistId} onClick={saveSettings}>Save settings</button>
      </section>

      <div className={styles.twoColumn}>
        <section className={styles.panel}><div className={styles.panelHeader}><div><h3>Move or copy a track</h3><p>Nothing is written to Plex until you confirm the calculated preview.</p></div></div>
          <div className={styles.formGrid}>
            <label>Source playlist<select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>{playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.plexPlaylistTitle}</option>)}</select></label>
            <label>Track<select value={moveTrackId} onChange={(event) => { setMoveTrackId(event.target.value); setMovePreview(null); }}><option value="">Select track</option>{sourceTracks.map((track) => <option key={track.id} value={track.trackId || ""}>{track.title} — {track.artist || "Unknown artist"}</option>)}</select></label>
            <label>Target playlist<select value={moveTargetId} onChange={(event) => { setMoveTargetId(event.target.value); setMovePreview(null); }}><option value="">Select related target</option>{moveTargetOptions.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.plexPlaylistTitle}</option>)}</select></label>
            <label>Action<select value={moveMode} onChange={(event) => { setMoveMode(event.target.value); setMovePreview(null); }}><option value="MOVE">Move and replace source</option><option value="COPY">Copy</option></select></label>
          </div><button className={styles.secondaryButton} disabled={busy || !moveTrackId || !moveTargetId} onClick={previewMove}><GitCompareArrows size={16} /> Preview impact</button> <button className={styles.secondaryButton} disabled={busy || !moveTrackId} onClick={() => markSharedCore(true)}><Sparkles size={16} /> Mark shared core</button> <button className={styles.secondaryButton} disabled={busy || !moveTrackId} onClick={() => markSharedCore(false)}>Remove core status</button>
          {movePreview && <div className={styles.chain}><strong>{movePreview.action}: {movePreview.track.title}</strong><p>{movePreview.source.title} → {movePreview.target.title}</p><p>Overlap {movePreview.overlap.before}% → {movePreview.overlap.after}% · limit {movePreview.overlap.limit}% · BPM fit {movePreview.target.bpmFit}</p>{movePreview.warnings.map((warning: string) => <p key={warning}>{warning}</p>)}<button className={styles.primaryButton} disabled={busy || !movePreview.canApply} onClick={applyMove}>Confirm and apply</button></div>}
        </section>
        <section className={styles.panel}><div className={styles.panelHeader}><div><h3>Rebalance related playlists</h3><p>Inspect overlap conflicts before selecting any replacement changes.</p></div></div>
          <button className={styles.secondaryButton} disabled={busy} onClick={previewRebalance}><RefreshCw size={16} /> Build preview</button>
          {rebalancePreview && <div className={styles.chain}><strong>{rebalancePreview.pairs.filter((pair: any) => pair.needsRebalance).length} pair(s) need attention</strong>{rebalancePreview.pairs.map((pair: any) => <p key={pair.relationship.id}>{pair.overlap.sourcePlaylist.plexPlaylistTitle} / {pair.overlap.targetPlaylist.plexPlaylistTitle}: {pair.overlap.sharedTrackPercentage}% (limit {pair.limit}%)</p>)}{rebalancePreview.warnings.map((warning: string) => <p key={warning}>{warning}</p>)}</div>}
        </section>
      </div>

      <section className={styles.panel}><div className={styles.panelHeader}><div><h3>Overlap warnings</h3><p>The enforced percentage is shared canonical tracks divided by the smaller active playlist. Jaccard similarity is shown separately.</p></div></div>
        <div className={styles.tableWrap}><table><thead><tr><th>Playlist A</th><th>Playlist B</th><th>Relationship</th><th>Shared tracks</th><th>Overlap</th><th>Jaccard</th><th>Shared artists</th><th>Shared albums</th><th>Limit</th><th>Status</th></tr></thead><tbody>
          {!dashboard?.pairs.length && <tr><td colSpan={10} className={styles.empty}>No relationships yet. Add one above to begin coordination.</td></tr>}
          {dashboard?.pairs.map((pair) => <tr key={pair.relationshipId}><td>{pair.playlistA.plexPlaylistTitle}</td><td>{pair.playlistB.plexPlaylistTitle}</td><td>{pair.relationshipType.replaceAll("_", " ")}</td><td>{pair.sharedTrackCount}{pair.sharedCoreTrackCount ? ` (${pair.sharedCoreTrackCount} core)` : ""}</td><td>{pair.sharedTrackPercentage}%</td><td>{pair.jaccardSimilarity}%</td><td>{pair.sharedArtistCount} · {pair.sharedArtistPercentage}%</td><td>{pair.sharedAlbumCount} · {pair.sharedAlbumPercentage}%</td><td>{pair.limit}%</td><td><span className={`${styles.status} ${statusClass(pair.status)}`}>{pair.status}</span></td></tr>)}
        </tbody></table></div>
      </section>
    </main>
  );
}
