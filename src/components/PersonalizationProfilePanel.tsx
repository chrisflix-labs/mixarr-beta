"use client";

import Link from "next/link";
import { useState } from "react";
import { Brain, Database, RefreshCw, ShieldCheck, SlidersHorizontal, Trash2 } from "lucide-react";
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
  const profile = data.profile;

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
        <p><strong>Local and private.</strong> Likes, dislikes, never-recommend choices, artist preferences, playlist-fit feedback, transition feedback, and learned behavior stay in your local Mixarr database. Disable personalization to stop these signals affecting generation without deleting them, or reset them at any time. No personalization data is sent to an external service.</p>
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
            <section><h3>Playlist-specific profiles</h3>{data.playlistProfiles.length ? <div className={styles.signalList}>{data.playlistProfiles.map((item: any) => <div key={item.playlistId} className={styles.playlistPreference}><strong>{item.name}</strong><small>{item.id ? (item.isLearned ? "Learned profile" : "Manually configured") : "Uses default"}</small><select aria-label={`Personalization mode for ${item.name}`} value={item.mode} disabled={busy !== null} onChange={(event) => savePlaylistMode(item.playlistId, event.target.value)}><option value="GENERAL_PROFILE">Use my general profile</option><option value="PLAYLIST_SPECIFIC">Use playlist-specific preferences</option><option value="GLOBAL_ONLY">Global scoring only</option></select>{item.mode === "PLAYLIST_SPECIFIC" && <div className={styles.playlistOverrides}><label><input type="checkbox" checked={(item.energyMin ?? 0) >= .6} disabled={busy !== null} onChange={(event) => updatePlaylistPreferences(item, { energyMin: event.target.checked ? .6 : null, energyMax: event.target.checked ? 1 : null })} /> High energy</label><label><input type="checkbox" checked={(item.deepCutPreference ?? 0) >= .55} disabled={busy !== null} onChange={(event) => updatePlaylistPreferences(item, { deepCutPreference: event.target.checked ? .8 : null, discoveryPreference: event.target.checked ? .8 : null })} /> More deep cuts</label><label><input type="checkbox" checked={item.avoidLiveRecordings === true} disabled={busy !== null} onChange={(event) => updatePlaylistPreferences(item, { avoidLiveRecordings: event.target.checked })} /> Avoid live recordings</label><label><input type="checkbox" checked={item.avoidLowConfidenceMetadata === true} disabled={busy !== null} onChange={(event) => updatePlaylistPreferences(item, { avoidLowConfidenceMetadata: event.target.checked })} /> Avoid low-confidence metadata</label></div>}{item.isLearned && <button type="button" disabled={busy !== null} onClick={() => resetLearnedPlaylist(item.playlistId)}>Reset learned profile</button>}</div>)}</div> : <p className={styles.empty}>Playlists use your general profile unless you add an override.</p>}</section>
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
