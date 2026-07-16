"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Clock3, Database, Gauge, History, RefreshCw, RotateCcw, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import styles from "./PlaybackAwarenessPanel.module.css";

async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

function date(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "Never";
}

function duration(value?: number | null) {
  if (value == null) return "—";
  return value < 1000 ? `${value} ms` : `${Math.round(value / 1000)}s`;
}

export default function PlaybackAwarenessPanel({ initialSummary, initialUsers, initialStates }: {
  initialSummary: any;
  initialUsers: any[];
  initialStates: any[];
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [users, setUsers] = useState(initialUsers);
  const [states, setStates] = useState(initialStates);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("forgotten");
  const [tracks, setTracks] = useState<any>(null);
  const settings = summary.settings.settings;
  const mappings = summary.settings.mappings || [];

  async function refresh() {
    const [nextSummary, nextUsers, nextStatus] = await Promise.all([
      api("/api/playback/summary"),
      api("/api/playback/users"),
      api("/api/playback/status"),
    ]);
    setSummary(nextSummary);
    setUsers(nextUsers.servers || []);
    setStates(nextStatus.states || []);
  }

  useEffect(() => {
    const active = states.some((state) => state.currentState === "syncing");
    if (!active) return;
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 5000);
    return () => window.clearInterval(timer);
  }, [states]);

  useEffect(() => {
    api(`/api/playback/tracks?category=${category}&pageSize=20`).then(setTracks).catch(() => setTracks(null));
  }, [category, summary.counts.totalProfiles]);

  async function update(changes: Record<string, unknown>) {
    setBusy("settings"); setError(""); setMessage("");
    try {
      await api("/api/playback/settings", { method: "PATCH", body: JSON.stringify(changes) });
      await refresh();
      setMessage("Playback settings saved.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not save playback settings");
    } finally { setBusy(""); }
  }

  async function mapUser(serverId: string, plexAccountId: string) {
    if (!plexAccountId) return;
    setBusy(`map:${serverId}`); setError(""); setMessage("");
    try {
      await api("/api/playback/users", { method: "PATCH", body: JSON.stringify({ serverId, plexAccountId, enabled: true }) });
      await refresh();
      setMessage("Plex user mapping updated.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not update Plex user mapping");
    } finally { setBusy(""); }
  }

  async function sync(serverId: string, mode: "incremental" | "full" = "incremental") {
    setBusy(`sync:${serverId}`); setError(""); setMessage("");
    try {
      await api("/api/playback/sync", { method: "POST", body: JSON.stringify({ serverId, mode }) });
      setMessage("Playback history sync started. Status will update automatically.");
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not start playback sync");
    } finally { setBusy(""); }
  }

  async function rebuild() {
    if (!window.confirm("Rebuild your playback recommendation profile from locally stored raw Plex history?")) return;
    setBusy("rebuild"); setError(""); setMessage("");
    try {
      await api("/api/playback/rebuild", { method: "POST", body: JSON.stringify({ scope: "user" }) });
      setMessage("Playback profile rebuild started. Progress is available in Job History.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not start playback profile rebuild");
    } finally { setBusy(""); }
  }

  async function reset() {
    const confirmation = window.prompt("Type RESET PLAYBACK PROFILE to remove derived playback profiles. Raw Plex history will be preserved.");
    if (confirmation !== "RESET PLAYBACK PROFILE") return;
    setBusy("reset"); setError(""); setMessage("");
    try {
      await api("/api/playback/reset", { method: "POST", body: JSON.stringify({ confirm: confirmation }) });
      await refresh();
      setMessage("Derived playback profile reset. Raw playback history was preserved.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not reset playback profile");
    } finally { setBusy(""); }
  }

  return (
    <div className={styles.wrapper}>
      <section className={styles.hero}>
        <div><span className={styles.kicker}><Sparkles size={14} /> Playback Recommendations <b>BETA</b></span><h3>Listening History &amp; Playback Awareness</h3><p>Let Plex listening history make small, visible changes to Smart Mix recommendations.</p></div>
        <label className={styles.master}><input type="checkbox" checked={settings.enabled} disabled={Boolean(busy)} onChange={(event) => update({ enabled: event.target.checked })} /><span>{settings.enabled ? "Enabled" : "Disabled"}</span></label>
      </section>

      {!mappings.length && <div className={styles.warning}><AlertTriangle size={18} /><div><strong>Plex user mapping required</strong><p>Playback recommendations stay inactive until your Mixarr account is mapped to the correct Plex user. History is never merged across users.</p></div></div>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {message && <p className={styles.notice}>{message}</p>}

      <section className={styles.section}>
        <h4><UserRound size={17} /> Plex user mapping</h4>
        <div className={styles.serverList}>
          {users.length ? users.map((server) => {
            const mapping = mappings.find((item: any) => item.serverId === server.id);
            return <article key={server.id}><div><strong>{server.name}</strong><small>{mapping ? `Mapped to ${mapping.plexUsername}` : "Not mapped"}</small></div><select aria-label={`Plex user for ${server.name}`} value={mapping?.plexAccountId || ""} disabled={Boolean(busy)} onChange={(event) => mapUser(server.id, event.target.value)}><option value="">Select Plex user…</option>{server.accounts.map((account: any) => <option key={account.id} value={account.id}>{account.username}{account.email ? ` (${account.email})` : ""}</option>)}</select><button type="button" disabled={Boolean(busy)} onClick={() => sync(server.id)}><RefreshCw size={14} /> Sync now</button></article>;
          }) : <p className={styles.empty}>Run Sync now after your Plex server is connected to discover available Plex users.</p>}
        </div>
      </section>

      <section className={styles.controls}>
        <label><span><strong>Playback influence</strong><em>{Math.round(settings.influence * 100)}%</em></span><input type="range" min="0" max="100" step="5" value={Math.round(settings.influence * 100)} disabled={Boolean(busy) || !settings.enabled} onChange={(event) => update({ influence: Number(event.target.value) / 100 })} /><small>This layer also respects the existing maximum personalization influence cap.</small></label>
        <label><span>Avoid tracks played within</span><select value={settings.recentlyPlayedWindowDays ?? ""} disabled={Boolean(busy)} onChange={(event) => update({ recentlyPlayedWindowDays: event.target.value ? Number(event.target.value) : null })}><option value="">Disabled</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option><option value="90">90 days</option></select></label>
        <label><span>Recently played behavior</span><select value={settings.recentlyPlayedBehavior} disabled={Boolean(busy)} onChange={(event) => update({ recentlyPlayedBehavior: event.target.value })}><option value="disabled">Disabled</option><option value="soft">Soft penalty</option><option value="strict">Strict exclusion</option></select><small>Strict mode never removes locked, important, or explicitly selected tracks.</small></label>
        <label><span>Forgotten favorite threshold</span><select value={settings.forgottenFavoriteDays ?? ""} disabled={Boolean(busy)} onChange={(event) => update({ forgottenFavoriteDays: event.target.value ? Number(event.target.value) : null })}><option value="">Disabled</option><option value="90">Not played for 3 months</option><option value="180">Not played for 6 months</option><option value="365">Not played for 1 year</option></select><small>Mixarr can occasionally bring back tracks you listened to often but have not heard recently.</small></label>
      </section>

      <section className={styles.checks}>
        {[["useCompletionHistory", "Use completed-track history"], ["useReplayHistory", "Use replay history"], ["useSkipHistory", "Use skip history"], ["playbackAwareDiscovery", "Playback-aware discovery"]].map(([key, label]) => <label key={key}><input type="checkbox" checked={Boolean(settings[key])} disabled={Boolean(busy) || !settings.enabled} onChange={(event) => update({ [key]: event.target.checked })} /><span>{label}</span></label>)}
      </section>

      <dl className={styles.stats}>
        <div><dt>Recommendation status</dt><dd>{summary.status}</dd></div>
        <div><dt>Playback confidence</dt><dd>{summary.confidenceLabel}</dd></div>
        <div><dt>Played in 7 days</dt><dd>{summary.counts.played7.toLocaleString()}</dd></div>
        <div><dt>Played in 30 days</dt><dd>{summary.counts.played30.toLocaleString()}</dd></div>
        <div><dt>Frequently completed</dt><dd>{summary.counts.completed.toLocaleString()}</dd></div>
        <div><dt>Frequently replayed</dt><dd>{summary.counts.replayed.toLocaleString()}</dd></div>
        <div><dt>Frequently skipped</dt><dd>{summary.counts.skipped.toLocaleString()}</dd></div>
        <div><dt>Forgotten candidates</dt><dd>{summary.counts.forgotten.toLocaleString()}</dd></div>
      </dl>

      <section className={styles.section}>
        <div className={styles.sectionHead}><h4><Database size={17} /> Playback profile tracks</h4><select aria-label="Playback category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="forgotten">Forgotten favorites</option><option value="completed">Frequently completed</option><option value="replayed">Frequently replayed</option><option value="skipped">Frequently skipped</option><option value="recent">Recently played</option></select></div>
        <div className={styles.trackList}>{tracks?.profiles?.length ? tracks.profiles.map((profile: any) => <article key={profile.id}><div><strong>{profile.track.title}</strong><small>{profile.track.artist.title} · {profile.track.album.title}</small></div><span>{profile.totalPlayCount} plays · {Math.round(profile.completionRate * 100)}% complete · {Math.round(profile.playbackConfidence * 100)}% confidence</span></article>) : <p className={styles.empty}>No tracks have enough evidence for this category.</p>}</div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}><h4><Clock3 size={17} /> Playback sync status</h4><Link href="/jobs?type=playback_history"><History size={14} /> View Job History</Link></div>
        <div className={styles.stateList}>{states.length ? states.map((state) => <article key={state.id}><div><strong>{state.server.name}</strong><small>{state.currentState} · {state.syncMode || "not run"}</small></div><dl><div><dt>Last success</dt><dd>{date(state.lastSuccessfulSyncAt)}</dd></div><div><dt>Imported events</dt><dd>{state.importedEventCount.toLocaleString()}</dd></div><div><dt>Updated profiles</dt><dd>{state.updatedProfileCount.toLocaleString()}</dd></div><div><dt>Users discovered</dt><dd>{state.discoveredUserCount}</dd></div><div><dt>Oldest history</dt><dd>{date(state.oldestAvailablePlexHistoryAt)}</dd></div><div><dt>Duration</dt><dd>{duration(state.syncDurationMs)}</dd></div></dl>{state.errorMessage && <p className={styles.error}>{state.errorMessage}</p>}</article>) : <p className={styles.empty}>Playback history has not been synchronized yet.</p>}</div>
      </section>

      <div className={styles.privacy}><ShieldCheck size={20} /><p><strong>Local and separated by user.</strong> Mixarr reads Plex playback history from your configured server and stores it in the local database. No cloud recommendation service is required. Disabling playback recommendations stops scoring influence without deleting history. One Plex user&apos;s history is never shown to another non-admin user.</p></div>

      <div className={styles.actions}><button type="button" disabled={Boolean(busy)} onClick={rebuild}><RotateCcw size={15} /> Rebuild playback profiles</button><button type="button" className={styles.danger} disabled={Boolean(busy)} onClick={reset}><Database size={15} /> Reset derived profile</button></div>
    </div>
  );
}
