"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Activity, AlertTriangle, Check, ChevronDown, History, Lock, LockOpen, RefreshCw, Sparkles, Undo2, Wand2, X } from "lucide-react";
import styles from "@/app/generated-playlists/generated-playlists.module.css";
import TrackFeedbackMenu from "./TrackFeedbackMenu";

type Mode = "replace_weak_tracks" | "replace_low_scoring" | "improve_bpm_flow" | "increase_energy" | "increase_discovery" | "smooth_mood_transitions" | "regenerate_section" | "manual_selection";

const actions: Array<{ mode: Mode; title: string; description: string }> = [
  { mode: "replace_weak_tracks", title: "Replace Weak Tracks", description: "Find the tracks hurting this playlist most." },
  { mode: "improve_bpm_flow", title: "Improve BPM Flow", description: "Repair abrupt BPM changes and preserve the existing ramp." },
  { mode: "increase_energy", title: "Make More Energetic", description: "Raise energy while keeping the current structure." },
  { mode: "increase_discovery", title: "Add More Discovery", description: "Introduce suitable deep cuts and lesser-played tracks." },
  { mode: "smooth_mood_transitions", title: "Smooth Mood Transitions", description: "Improve emotional flow between neighboring tracks." },
  { mode: "regenerate_section", title: "Regenerate a Section", description: "Choose the intro, middle, ending, or a custom range." },
  { mode: "replace_low_scoring", title: "Replace Low-Scoring", description: "Replace tracks below a visible score threshold." },
  { mode: "manual_selection", title: "Regenerate Selected", description: "Replace only the tracks selected below." },
];

const defaultSettings = {
  preserveLength: true,
  keepLikedTracks: true,
  preserveLockedTracks: true,
  preserveMoodCurve: true,
  preserveBpmCurve: true,
  preserveEnergyCurve: true,
  preserveOrder: true,
  replacementSensitivity: "balanced",
  minimumReplacementImprovement: 8,
  energyAdjustment: 0.16,
  discoveryAdjustment: 0.15,
  durationTolerance: 0.05,
  maximumReplacements: 10,
  scoreThreshold: 65,
};

function weaknessLabel(value: number) {
  if (value >= 85) return "Critical replacement candidate";
  if (value >= 65) return "Very weak";
  if (value >= 45) return "Weak";
  if (value >= 25) return "Acceptable fit";
  return "Strong fit";
}

function duration(value: number) {
  const minutes = Math.round(Math.max(0, value) / 60000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

export default function AdvancedRegenerationWorkspace({ playlistId, playlistName, onClose, onApplied }: {
  playlistId: string;
  playlistName: string;
  onClose: () => void;
  onApplied: (message: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("replace_weak_tracks");
  const [settings, setSettings] = useState(defaultSettings);
  const [section, setSection] = useState("middle");
  const [customStart, setCustomStart] = useState(1);
  const [customEnd, setCustomEnd] = useState(5);
  const [analysis, setAnalysis] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [lockProposed, setLockProposed] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setBusy("Analyzing playlist");
    setError("");
    try {
      const [analysisResponse, historyResponse] = await Promise.all([
        axios.post(`/api/playlists/${playlistId}/regeneration/analyze`, { mode, ...settings }),
        axios.get(`/api/playlists/${playlistId}/regeneration/history`),
      ]);
      setAnalysis(analysisResponse.data);
      setHistory(historyResponse.data.history || []);
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || "Unable to analyze this playlist.");
    } finally {
      setBusy("");
    }
  };

  useEffect(() => { load(); }, [playlistId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedCount = selectedIds.size;
  const trackById = useMemo(() => new Map((analysis?.tracks || []).map((track: any) => [track.id, track])), [analysis]);

  const toggleSetting = (key: keyof typeof defaultSettings) => {
    setSettings((current) => ({ ...current, [key]: !current[key] }));
  };

  const toggleTrack = (trackId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(trackId)) next.delete(trackId); else next.add(trackId);
      return next;
    });
  };

  const updateLock = async (track: any) => {
    setBusy(`Updating ${track.title}`);
    setError("");
    try {
      await axios.patch(`/api/playlists/${playlistId}/tracks/${track.id}/lock`, { locked: !track.locked });
      setAnalysis((current: any) => ({ ...current, tracks: current.tracks.map((item: any) => item.id === track.id ? { ...item, locked: !item.locked } : item) }));
      setPreview(null);
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || "Unable to update the track lock.");
    } finally { setBusy(""); }
  };

  const bulkLock = async (kind: "selected" | "liked" | "unlock_all") => {
    setBusy("Updating track locks");
    try {
      const body = kind === "liked"
        ? { locked: true, likedOnly: true }
        : kind === "unlock_all"
        ? { locked: false }
        : { locked: true, trackIds: Array.from(selectedIds) };
      await axios.post(`/api/playlists/${playlistId}/tracks/bulk-lock`, body);
      await load();
      setPreview(null);
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || "Unable to update track locks.");
      setBusy("");
    }
  };

  const generatePreview = async () => {
    if (mode === "manual_selection" && selectedCount === 0) {
      setError("Select one or more tracks before regenerating selected tracks.");
      return;
    }
    setBusy("Building preview");
    setError("");
    setPreview(null);
    try {
      const response = await axios.post(`/api/playlists/${playlistId}/regeneration/preview`, {
        mode,
        ...settings,
        ...(mode === "manual_selection" ? { targetTrackIds: Array.from(selectedIds) } : {}),
        ...(mode === "regenerate_section" ? { targetSection: { type: section, ...(section === "custom_range" ? { start: customStart, end: customEnd } : {}) } } : {}),
      });
      setPreview(response.data);
      setAccepted(new Set(response.data.changes.map((change: any) => change.position)));
      setLockProposed(new Set());
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || "Unable to build a regeneration preview.");
    } finally { setBusy(""); }
  };

  const apply = async () => {
    if (!preview) return;
    setBusy("Applying changes");
    setError("");
    try {
      const response = await axios.post(`/api/playlists/${playlistId}/regeneration/apply`, {
        previewId: preview.previewId,
        acceptedPositions: Array.from(accepted),
        lockProposedPositions: Array.from(lockProposed),
      });
      const data = response.data;
      onApplied(data.rejected
        ? "Regeneration preview rejected. The playlist was not changed."
        : `Playlist updated successfully. ${data.tracksReplaced} track${data.tracksReplaced === 1 ? "" : "s"} replaced. Score ${data.originalScore ?? "-"} to ${data.appliedScore}.`);
      setPreview(null);
      await load();
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || "Unable to apply regeneration changes.");
      setBusy("");
    }
  };

  const undo = async () => {
    if (!window.confirm("Undo the most recent applied regeneration and restore its server-side revision?")) return;
    setBusy("Restoring playlist revision");
    setError("");
    try {
      const response = await axios.post(`/api/playlists/${playlistId}/regeneration/undo`);
      onApplied(`Regeneration undone. ${response.data.restoredTrackCount} tracks restored.`);
      await load();
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || "Unable to undo the most recent regeneration.");
      setBusy("");
    }
  };

  return (
    <section className={styles.advancedWorkspace} aria-labelledby="advanced-regeneration-title">
      <header className={styles.workspaceHeader}>
        <div>
          <span className={styles.kicker}><Sparkles size={14} /> Smart Mix Engine v2 <b>BETA</b></span>
          <h3 id="advanced-regeneration-title">Regenerate Playlist: {playlistName}</h3>
          <p>Analyze targeted improvements without rebuilding everything. Saved settings, locks, and curve intent are preserved.</p>
        </div>
        <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close regeneration workspace"><X /></button>
      </header>

      {busy && <div className={styles.progressNotice} role="status"><RefreshCw className="animate-spin" size={16} /> {busy}</div>}
      {error && <div className={styles.errorNotice} role="alert"><AlertTriangle size={16} /> {error}</div>}

      <div className={styles.actionGrid} aria-label="Regeneration actions">
        {actions.map((action) => (
          <button key={action.mode} type="button" className={`${styles.actionCard} ${mode === action.mode ? styles.actionCardSelected : ""}`} onClick={() => { setMode(action.mode); setPreview(null); }}>
            <strong>{action.title}</strong><span>{action.description}</span>
          </button>
        ))}
      </div>

      {mode === "regenerate_section" && (
        <div className={styles.sectionSelector} aria-label="Playlist section">
          {(["intro", "early", "middle", "late", "ending", "custom_range"] as const).map((item) => (
            <button key={item} type="button" aria-pressed={section === item} onClick={() => setSection(item)}>{item}</button>
          ))}
        </div>
      )}
      {mode === "regenerate_section" && section === "custom_range" && (
        <div className={styles.customRange}>
          <label>Start position<input type="number" min="1" max={analysis?.tracks?.length || 5000} value={customStart} onChange={(event) => setCustomStart(Number(event.target.value))} /></label>
          <label>End position<input type="number" min={customStart} max={analysis?.tracks?.length || 5000} value={customEnd} onChange={(event) => setCustomEnd(Number(event.target.value))} /></label>
        </div>
      )}

      <div className={styles.preservationGrid}>
        {([
          ["preserveLength", "Preserve playlist length"], ["keepLikedTracks", "Keep liked tracks"], ["preserveLockedTracks", "Keep locked tracks"],
          ["preserveMoodCurve", "Preserve mood curve"], ["preserveBpmCurve", "Preserve BPM curve"], ["preserveEnergyCurve", "Preserve energy curve"], ["preserveOrder", "Preserve playlist order"],
        ] as Array<[keyof typeof defaultSettings, string]>).map(([key, label]) => (
          <label key={key}><input type="checkbox" checked={Boolean(settings[key])} onChange={() => toggleSetting(key)} /> <span>{label}</span></label>
        ))}
      </div>

      <details className={styles.advancedControls}>
        <summary><ChevronDown size={15} /> Advanced controls</summary>
        <div>
          <label>Replacement sensitivity<select value={settings.replacementSensitivity} onChange={(event) => setSettings({ ...settings, replacementSensitivity: event.target.value })}><option value="conservative">Conservative</option><option value="balanced">Balanced</option><option value="aggressive">Aggressive</option></select></label>
          <label>Minimum score improvement: +{settings.minimumReplacementImprovement}<input aria-label="Minimum score improvement" type="range" min="0" max="25" value={settings.minimumReplacementImprovement} onChange={(event) => setSettings({ ...settings, minimumReplacementImprovement: Number(event.target.value) })} /></label>
          <label>Maximum replacements: {settings.maximumReplacements}<input aria-label="Maximum number of replacements" type="range" min="1" max="25" value={settings.maximumReplacements} onChange={(event) => setSettings({ ...settings, maximumReplacements: Number(event.target.value) })} /></label>
          {mode === "replace_low_scoring" && <label>Replace scores below: {settings.scoreThreshold}<input aria-label="Low score threshold" type="range" min="20" max="90" value={settings.scoreThreshold} onChange={(event) => setSettings({ ...settings, scoreThreshold: Number(event.target.value) })} /></label>}
          {mode === "increase_energy" && <label>Energy adjustment: +{Math.round(settings.energyAdjustment * 100)}%<input aria-label="Energy adjustment" type="range" min="0.08" max="0.25" step="0.01" value={settings.energyAdjustment} onChange={(event) => setSettings({ ...settings, energyAdjustment: Number(event.target.value) })} /></label>}
          {mode === "increase_discovery" && <label>Discovery increase: +{Math.round(settings.discoveryAdjustment * 100)}%<input aria-label="Discovery adjustment" type="range" min="0.05" max="0.4" step="0.01" value={settings.discoveryAdjustment} onChange={(event) => setSettings({ ...settings, discoveryAdjustment: Number(event.target.value) })} /></label>}
        </div>
      </details>

      <div className={styles.workspaceActions}>
        <button type="button" className={styles.primaryButton} onClick={generatePreview} disabled={Boolean(busy)}><Wand2 size={15} /> Generate Preview</button>
        <button type="button" className={styles.secondaryButton} onClick={() => bulkLock("selected")} disabled={selectedCount === 0 || Boolean(busy)}><Lock size={15} /> Lock selected ({selectedCount})</button>
        <button type="button" className={styles.secondaryButton} onClick={() => bulkLock("liked")} disabled={Boolean(busy)}><Lock size={15} /> Lock liked</button>
        <button type="button" className={styles.secondaryButton} onClick={() => bulkLock("unlock_all")} disabled={Boolean(busy)}><LockOpen size={15} /> Unlock all</button>
        <button type="button" className={styles.secondaryButton} onClick={undo} disabled={Boolean(busy) || !history.some((item) => item.status === "applied")}><Undo2 size={15} /> Undo regeneration</button>
      </div>

      {analysis && (
        <div className={styles.analysisTrackList} aria-label="Playlist track analysis">
          {analysis.tracks.map((track: any) => (
            <article key={track.id} className={track.weakness.overallWeakness >= 45 ? styles.weakTrack : ""}>
              <label className={styles.trackSelect}><input type="checkbox" checked={selectedIds.has(track.id)} onChange={() => toggleTrack(track.id)} aria-label={`Select ${track.title}`} /><span>{track.position}</span></label>
              <div><strong>{track.title}</strong><p>{track.artist?.title || "Unknown artist"} · {weaknessLabel(track.weakness.overallWeakness)} ({track.weakness.overallWeakness})</p><small>{[...track.weakness.reasons, ...track.weakness.confidenceReasons].join(" · ") || "No scoring concerns"}</small></div>
              <button type="button" className={styles.iconButton} onClick={() => updateLock(track)} aria-label={`${track.locked ? "Unlock" : "Lock"} ${track.title}`} title={track.locked ? "Locked: regeneration will preserve this position" : "Lock this track"}>{track.locked ? <Lock size={17} /> : <LockOpen size={17} />}</button>
            </article>
          ))}
        </div>
      )}

      {preview && (
        <section className={styles.advancedPreview} aria-labelledby="targeted-preview-title">
          <div className={styles.previewHeader}><div><span className={styles.kicker}><Check size={14} /> Preview Required</span><h4 id="targeted-preview-title">Review proposed replacements</h4><p>Accept or reject each position. The saved playlist is unchanged until Apply Changes.</p></div></div>
          <div className={styles.scoreComparison} aria-label={`Playlist score changes from ${preview.originalPlaylistScore} to ${preview.proposedPlaylistScore}`}>
            <div><span>Overall score</span><strong>{preview.originalPlaylistScore} → {preview.proposedPlaylistScore}</strong></div>
            <div><span>Estimated improvement</span><strong>{preview.estimatedImprovement >= 0 ? "+" : ""}{preview.estimatedImprovement}</strong></div>
            <div><span>Duration</span><strong>{duration(preview.originalDurationMs)} → {duration(preview.proposedDurationMs)}</strong></div>
            <div><span>Changes</span><strong>{accepted.size} of {preview.changes.length} accepted</strong></div>
          </div>
          {preview.identityImpact && <div className={styles.warningPanel} aria-label={`Identity impact ${preview.identityImpact.level}`}><p><strong>Identity impact: {preview.identityImpact.level}</strong></p>{preview.identityImpact.summary.map((item: string) => <p key={item}><Check size={13} /> {item}</p>)}</div>}
          {preview.warnings.length > 0 && <div className={styles.warningPanel}>{preview.warnings.map((warning: string) => <p key={warning}><AlertTriangle size={14} /> {warning}</p>)}</div>}
          {preview.changes.length === 0 ? <div className={styles.statePanel}>No replacements available. Mixarr kept the original tracks.</div> : (
            <div className={styles.changeList}>
              {preview.changes.map((change: any) => {
                const original = change.originalTrack || trackById.get(change.originalTrackId);
                const proposed = change.proposedTrack;
                return <article key={change.position}>
                  <label><input type="checkbox" checked={accepted.has(change.position)} onChange={() => setAccepted((current) => { const next = new Set(current); if (next.has(change.position)) next.delete(change.position); else next.add(change.position); return next; })} aria-label={`Accept replacement at position ${change.position}`} /><span>Position {change.position}</span></label>
                  <div className={styles.trackSwap}><div><small>Original · {change.originalScore}</small><strong>{original?.title}</strong><span>{original?.artist?.title}</span></div><Activity size={18} /><div><small>Proposed · {change.proposedScore} (+{change.improvement})</small><strong>{proposed?.title}</strong><span>{proposed?.artist?.title}</span></div></div>
                  <p>{change.reasons.join(" · ")}</p>
                  <div className={styles.metricDiff}><span>BPM {change.originalMetrics.bpm ?? "-"} → {change.proposedMetrics.bpm ?? "-"}</span><span>Mood {change.originalMetrics.mood?.toFixed(2) ?? "-"} → {change.proposedMetrics.mood?.toFixed(2) ?? "-"}</span><span>Energy {change.originalMetrics.energy?.toFixed(2) ?? "-"} → {change.proposedMetrics.energy?.toFixed(2) ?? "-"}</span><span>Popularity {change.originalMetrics.popularity ?? "-"} → {change.proposedMetrics.popularity ?? "-"}</span></div>
                  <div className={styles.changeActions}>
                    <label><input type="checkbox" checked={lockProposed.has(change.position)} onChange={() => setLockProposed((current) => { const next = new Set(current); if (next.has(change.position)) next.delete(change.position); else next.add(change.position); return next; })} /> Lock proposed track after applying</label>
                    {original && <button type="button" className={styles.secondaryButton} onClick={() => updateLock(original)}><Lock size={14} /> Keep and lock original</button>}
                    {proposed && <TrackFeedbackMenu trackId={proposed.id} artistId={proposed.artistId || proposed.artist?.id} trackTitle={proposed.title} playlistId={playlistId} generationId={preview.id || undefined} sourceSurface="REGENERATION_PREVIEW" />}
                  </div>
                </article>;
              })}
            </div>
          )}
          <div className={styles.workspaceActions}><button type="button" className={styles.primaryButton} onClick={apply} disabled={Boolean(busy)}><Check size={15} /> Apply Changes</button><button type="button" className={styles.secondaryButton} onClick={() => setAccepted(new Set())}>Reject all</button><button type="button" className={styles.secondaryButton} onClick={() => setPreview(null)}>Return to settings</button></div>
        </section>
      )}

      <details className={styles.historyPanel}>
        <summary><History size={15} /> Regeneration history</summary>
        {history.length === 0 ? <p>No regeneration history yet.</p> : history.map((item) => <article key={item.id}><strong>{new Date(item.createdAt).toLocaleString()} · {String(item.mode).replaceAll("_", " ")}</strong><span>{item.tracksApplied || item.tracksProposed} tracks · Score {item.originalScore ?? "-"} → {item.appliedScore ?? item.proposedScore ?? "-"} · {item.status} · {item.engineVersion}</span></article>)}
      </details>
    </section>
  );
}
