"use client";

import Link from "next/link";
import { useState } from "react";
import { Brain, Database, Gauge, Headphones, RefreshCw, ShieldCheck, SlidersHorizontal, Trash2 } from "lucide-react";
import styles from "./PersonalizationProfilePanel.module.css";
import FeedbackManagement from "./FeedbackManagement";

type Props = {
  initialData: any;
  detailed?: boolean;
};

async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "Not calculated yet";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function eventLabel(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function PersonalizationProfilePanel({ initialData, detailed = false }: Props) {
  const [data, setData] = useState(initialData);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetMode, setResetMode] = useState<"learned" | "all">("learned");
  const [confirmation, setConfirmation] = useState("");
  const [advancedAdaptive, setAdvancedAdaptive] = useState(false);
  const profile = data.profile;
  const adaptive = data.adaptiveScoring?.settings;

  async function updateSettings(enabled: boolean, learningEnabled: boolean) {
    setBusy("settings");
    setError("");
    try {
      setData(await api("/api/personalization/profile", { method: "PATCH", body: JSON.stringify({ enabled, learningEnabled: enabled ? learningEnabled : false }) }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not update personalization settings");
    } finally {
      setBusy(null);
    }
  }

  async function recalculate() {
    setBusy("recalculate");
    setError("");
    try {
      const payload = await api("/api/personalization/recalculate", { method: "POST", body: "{}" });
      setData(payload.summary);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not rebuild your profile");
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    setBusy("reset");
    setError("");
    try {
      const payload = await api("/api/personalization/reset", { method: "POST", body: JSON.stringify({ mode: resetMode, confirm: confirmation }) });
      setData(payload.summary);
      setResetOpen(false);
      setConfirmation("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not reset personalization data");
    } finally {
      setBusy(null);
    }
  }

  async function savePlaylistMode(playlistId: string, mode: string) {
    setBusy(`playlist:${playlistId}`);
    setError("");
    try {
      await api(`/api/personalization/playlists/${playlistId}`, { method: "PATCH", body: JSON.stringify({ mode, enabled: mode !== "GLOBAL_ONLY", source: "MANUAL" }) });
      setData(await api("/api/personalization/profile"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not update playlist preferences");
    } finally {
      setBusy(null);
    }
  }

  async function resetLearnedPlaylist(playlistId: string) {
    setBusy(`playlist:${playlistId}`);
    setError("");
    try {
      await api(`/api/personalization/playlists/${playlistId}`, { method: "DELETE" });
      setData(await api("/api/personalization/profile"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not reset playlist learning");
    } finally {
      setBusy(null);
    }
  }

  async function updateAdaptive(changes: Record<string, unknown>) {
    setBusy("adaptive");
    setError("");
    try {
      const payload = await api("/api/personalization/adaptive", { method: "PATCH", body: JSON.stringify(changes) });
      if (changes.playlistId) setData(await api("/api/personalization/profile"));
      else setData((current: any) => ({ ...current, adaptiveScoring: payload }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not update adaptive scoring");
    } finally {
      setBusy(null);
    }
  }

  async function updatePlaylistPreferences(item: any, changes: Record<string, unknown>) {
    setBusy(`playlist:${item.playlistId}`);
    setError("");
    try {
      await api(`/api/personalization/playlists/${item.playlistId}`, { method: "PATCH", body: JSON.stringify({ mode: "PLAYLIST_SPECIFIC", enabled: true, source: "MANUAL", ...changes }) });
      setData(await api("/api/personalization/profile"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not update playlist preferences");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.controlGrid}>
        <label className={styles.toggleCard}>
          <span><Brain size={18} /><strong>Enable personalization</strong></span>
          <small>Apply small adjustments from your current profile.</small>
          <input type="checkbox" checked={profile.enabled} disabled={busy !== null} onChange={(event) => updateSettings(event.target.checked, profile.learningEnabled)} />
        </label>
        <label className={`${styles.toggleCard} ${!profile.enabled ? styles.disabled : ""}`}>
          <span><SlidersHorizontal size={18} /><strong>Enable behavior learning</strong></span>
          <small>Record supported selections, locks, replacements, and restores.</small>
          <input type="checkbox" checked={profile.learningEnabled} disabled={!profile.enabled || busy !== null} onChange={(event) => updateSettings(profile.enabled, event.target.checked)} />
        </label>
      </div>

      {adaptive && (
        <section className={styles.adaptivePanel}>
          <div className={styles.sectionHeading}>
            <div><h3><Gauge size={17} /> Adaptive Scoring</h3><p>Controls how strongly learned behavior may change the original Smart Mix score.</p></div>
            <label className={styles.inlineToggle}><input type="checkbox" checked={adaptive.enabled} disabled={busy !== null || !profile.enabled} onChange={(event) => updateAdaptive({ enabled: event.target.checked, preset: "custom" })} /> Enabled</label>
          </div>
          <div className={styles.presetRow} aria-label="Adaptive scoring presets">
            {["off", "light", "balanced", "strong", "maximum"].map((preset) => <button key={preset} type="button" className={adaptive.preset === preset ? styles.activePreset : ""} disabled={busy !== null || !profile.enabled} onClick={() => updateAdaptive({ preset })}>{preset[0].toUpperCase() + preset.slice(1)}</button>)}
          </div>
          <label className={styles.sliderLabel}>
            <span><strong>Maximum personalization influence</strong><em>{Math.round(adaptive.maximumInfluence * 100)}%</em></span>
            <input type="range" min="0" max="100" step="5" value={Math.round(adaptive.maximumInfluence * 100)} disabled={busy !== null || !adaptive.enabled || !profile.enabled} onChange={(event) => updateAdaptive({ maximumInfluence: Number(event.target.value) / 100, preset: "custom" })} />
            <small>At 50%, adaptive scoring can change the base score by at most 10 points. Existing hard exclusions and generation constraints still apply.</small>
          </label>
          <div className={styles.adaptiveChecks}>
            {[
              ["includeInferredBehavior", "Inferred behavior"],
              ["includePlaylistHistory", "Playlist history"],
              ["includePlaylistIdentity", "Playlist identity"],
              ["includeArtistPreferences", "Artist preferences"],
              ["includeMoodPreferences", "Mood preferences"],
              ["includeDiscoveryTolerance", "Discovery tolerance"],
              ["includeRepeatTolerance", "Repeat tolerance"],
              ["showExplanationsByDefault", "Open score explanations by default"],
            ].map(([key, label]) => <label key={key}><input type="checkbox" checked={Boolean(adaptive[key])} disabled={busy !== null || !adaptive.enabled} onChange={(event) => updateAdaptive({ [key]: event.target.checked, preset: "custom" })} /> {label}</label>)}
          </div>
          <button type="button" className={styles.advancedToggle} onClick={() => setAdvancedAdaptive((value) => !value)}>{advancedAdaptive ? "Hide" : "Show"} confidence and component controls</button>
          {advancedAdaptive && <div className={styles.advancedAdaptive}>
            <label><span>Minimum confidence</span><select value={adaptive.minimumConfidence} disabled={busy !== null} onChange={(event) => updateAdaptive({ minimumConfidence: event.target.value, preset: "custom" })}><option value="very_low">Very low</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
            <label><span>Positive limit</span><input type="number" min="0" max="20" value={adaptive.positiveAdjustmentLimit} onChange={(event) => updateAdaptive({ positiveAdjustmentLimit: Number(event.target.value), preset: "custom" })} /></label>
            <label><span>Negative limit</span><input type="number" min="0" max="20" value={adaptive.negativeAdjustmentLimit} onChange={(event) => updateAdaptive({ negativeAdjustmentLimit: Number(event.target.value), preset: "custom" })} /></label>
            <label><input type="checkbox" checked={adaptive.preferExplicitFeedback} onChange={(event) => updateAdaptive({ preferExplicitFeedback: event.target.checked, preset: "custom" })} /> Prefer explicit feedback</label>
            <label><input type="checkbox" checked={adaptive.reduceOldFeedback} onChange={(event) => updateAdaptive({ reduceOldFeedback: event.target.checked, preset: "custom" })} /> Reduce old feedback influence</label>
            <div className={styles.componentWeights}>
              <strong>Component influence</strong>
              {Object.entries(adaptive.componentWeights).map(([key, value]) => <label key={key}><span>{key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase())} <em>{Math.round(Number(value) * 100)}%</em></span><input type="range" min="0" max="200" step="10" value={Math.round(Number(value) * 100)} disabled={busy !== null} onChange={(event) => updateAdaptive({ componentWeights: { [key]: Number(event.target.value) / 100 }, preset: "custom" })} /></label>)}
            </div>
          </div>}
          <div className={styles.adaptiveStatus}><span>Model v{data.adaptiveScoring.profile.scoringVersion}</span><span>{data.adaptiveScoring.profile.observationCount} observations</span><span>{data.adaptiveScoring.profile.statisticCount} learned statistics</span><span>{data.adaptiveScoring.profile.needsRecalculation ? "Recalculation recommended" : "Up to date"}</span></div>
          <button type="button" className={styles.advancedToggle} disabled={busy !== null} onClick={() => updateAdaptive({ preset: "balanced" })}>Restore recommended defaults</button>
        </section>
      )}

      <div className={styles.actions}><Link href="/settings/personalization/playback"><Headphones size={15} /> Configure playback awareness</Link></div>

      {!profile.enabled && <p className={styles.stateMessage}>Smart Mix is currently using global scoring only.</p>}
      {profile.enabled && !profile.learningEnabled && <p className={styles.stateMessage}>Behavior learning is off. Your existing profile can still be used.</p>}
      {profile.enabled && data.interactionCount < profile.minimumEventsRequired && <p className={styles.stateMessage}>Keep selecting, rejecting, locking, or replacing tracks to help Mixarr learn.</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}

      <dl className={styles.stats}>
        <div><dt>Profile status</dt><dd>{data.status}</dd></div>
        <div><dt>Learning confidence</dt><dd>{data.confidencePercent}%</dd></div>
        <div><dt>Recorded interactions</dt><dd>{data.interactionCount}</dd></div>
        <div><dt>Last profile update</dt><dd>{formatDate(profile.lastCalculatedAt)}</dd></div>
      </dl>

      <div className={styles.privacy}>
        <ShieldCheck size={20} />
        <p><strong>Local and private.</strong> Adaptive Smart Mix scoring uses locally stored likes, dislikes, playlist history, artist preferences, and playlist identities to adjust track rankings. The original base score remains visible, and disabling adaptive scoring does not delete learning data. No personalization data is sent to an external service.</p>
      </div>

      {detailed ? (
        <>
          <div className={styles.sectionHeading}><h3>Profile summary</h3><button type="button" onClick={recalculate} disabled={busy !== null}><RefreshCw size={15} /> {busy === "recalculate" ? "Rebuilding…" : "Rebuild profile"}</button></div>
          <div className={styles.preferenceColumns}>
            <section><h4>Prefers</h4>{data.summary.prefers.length ? data.summary.prefers.map((item: any) => <Preference key={item.key} item={item} />) : <p className={styles.empty}>Mixarr has not learned any preferences yet.</p>}</section>
            <section><h4>Avoids</h4>{data.summary.avoids.length ? data.summary.avoids.map((item: any) => <Preference key={item.key} item={item} />) : <p className={styles.empty}>No avoidance preferences have enough evidence yet.</p>}</section>
          </div>

          <div className={styles.detailGrid}>
            <section><h3>Recent learning signals</h3>{data.recentSignals.length ? <div className={styles.signalList}>{data.recentSignals.map((signal: any) => <div key={signal.id}><span>{eventLabel(signal.eventType)}</span><strong>{signal.track.title}</strong><small>{signal.track.artist.title} · {formatDate(signal.occurredAt)}</small></div>)}</div> : <p className={styles.empty}>No interaction signals have been recorded.</p>}</section>
            <section><h3>Playlist-specific profiles</h3>{data.playlistProfiles.length ? <div className={styles.signalList}>{data.playlistProfiles.map((item: any) => <div key={item.playlistId} className={styles.playlistPreference}><strong>{item.name}</strong><small>{item.id ? (item.isLearned ? "Learned profile" : "Manually configured") : "Uses default"}</small><select aria-label={`Personalization mode for ${item.name}`} value={item.mode} disabled={busy !== null} onChange={(event) => savePlaylistMode(item.playlistId, event.target.value)}><option value="GENERAL_PROFILE">Use my general profile</option><option value="PLAYLIST_SPECIFIC">Use playlist-specific preferences</option><option value="GLOBAL_ONLY">Global scoring only</option></select><label className={styles.playlistInfluence}><span><input type="checkbox" checked={item.adaptiveInfluenceOverride != null} disabled={busy !== null} onChange={(event) => updateAdaptive({ playlistId: item.playlistId, playlistInfluenceOverride: event.target.checked ? adaptive.maximumInfluence : null })} /> Override adaptive influence</span>{item.adaptiveInfluenceOverride != null && <><input type="range" min="0" max="100" step="5" value={Math.round(item.adaptiveInfluenceOverride * 100)} disabled={busy !== null} onChange={(event) => updateAdaptive({ playlistId: item.playlistId, playlistInfluenceOverride: Number(event.target.value) / 100 })} /><small>{Math.round(item.adaptiveInfluenceOverride * 100)}% for this playlist</small></>}</label>{item.mode === "PLAYLIST_SPECIFIC" && <div className={styles.playlistOverrides}><label><input type="checkbox" checked={(item.energyMin ?? 0) >= .6} disabled={busy !== null} onChange={(event) => updatePlaylistPreferences(item, { energyMin: event.target.checked ? .6 : null, energyMax: event.target.checked ? 1 : null })} /> High energy</label><label><input type="checkbox" checked={(item.deepCutPreference ?? 0) >= .55} disabled={busy !== null} onChange={(event) => updatePlaylistPreferences(item, { deepCutPreference: event.target.checked ? .8 : null, discoveryPreference: event.target.checked ? .8 : null })} /> More deep cuts</label><label><input type="checkbox" checked={item.avoidLiveRecordings === true} disabled={busy !== null} onChange={(event) => updatePlaylistPreferences(item, { avoidLiveRecordings: event.target.checked })} /> Avoid live recordings</label><label><input type="checkbox" checked={item.avoidLowConfidenceMetadata === true} disabled={busy !== null} onChange={(event) => updatePlaylistPreferences(item, { avoidLowConfidenceMetadata: event.target.checked })} /> Avoid low-confidence metadata</label></div>}{item.isLearned && <button type="button" disabled={busy !== null} onClick={() => resetLearnedPlaylist(item.playlistId)}>Reset learned profile</button>}</div>)}</div> : <p className={styles.empty}>Playlists use your general profile unless you add an override.</p>}</section>
          </div>
          <FeedbackManagement />
        </>
      ) : (
        <div className={styles.actions}><Link href="/personalization">View profile details</Link><button type="button" onClick={recalculate} disabled={busy !== null}><RefreshCw size={15} /> Rebuild</button></div>
      )}

      <div className={styles.dangerRow}><span><Database size={18} /><span><strong>Reset personalization data</strong><small>Preserves Plex metadata, playlists, versions, and global Smart Mix settings.</small></span></span><button type="button" onClick={() => setResetOpen(true)} disabled={busy !== null}><Trash2 size={15} /> Reset</button></div>

      {resetOpen && (
        <div className={styles.modalLayer} role="presentation">
          <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="reset-title">
            <h3 id="reset-title">Reset Personalization Data?</h3>
            <p>This deletes interaction events, explicit likes and dislikes, never-recommend choices, artist preferences, playlist-fit and transition feedback, derived preferences, scoring adjustments, learned playlist profiles, confidence, and counters. It does not delete Plex metadata, playlists, versions, manual metadata corrections, or global Smart Mix settings.</p>
            <label><span>Reset mode</span><select value={resetMode} onChange={(event) => setResetMode(event.target.value as "learned" | "all")}><option value="learned">Learned behavior only</option><option value="all">All personalization, including manual profiles</option></select></label>
            <label><span>Type RESET PERSONALIZATION to confirm</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label>
            <div className={styles.modalActions}><button type="button" onClick={() => { setResetOpen(false); setConfirmation(""); }}>Cancel</button><button type="button" className={styles.destructive} disabled={confirmation !== "RESET PERSONALIZATION" || busy !== null} onClick={reset}>{busy === "reset" ? "Resetting…" : "Reset data"}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function Preference({ item }: { item: any }) {
  return <div className={styles.preference}><span>{item.label}</span><small>{item.learned ? "Learned" : "Manual"} · {Math.round(item.confidence * 100)}% confidence · {item.evidenceCount} signals · {item.active ? "Affects recommendations" : "Inactive"}</small></div>;
}
