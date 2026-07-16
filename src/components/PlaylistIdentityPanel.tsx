"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Brain, Copy, Edit3, RefreshCw, RotateCcw, Save, ShieldCheck } from "lucide-react";
import styles from "./PlaylistIdentityPanel.module.css";

const lockable = ["coreMoods", "energyRange", "energyCurve", "bpmRange", "maximumTransitionGap", "discoveryPreference", "preferredArtists", "preferredGenres", "livePreference"] as const;
const confidenceLabel = (value: string) => String(value || "INSUFFICIENT_DATA").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function PlaylistIdentityPanel({ playlistId, playlistName, onClone }: { playlistId: string; playlistName: string; onClone?: () => void }) {
  const [data, setData] = useState<any>(null);
  const [opened, setOpened] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [moods, setMoods] = useState<string[]>([]);
  const [form, setForm] = useState<any>({ enabled: true, learningEnabled: true, preservationMode: "BALANCED", strength: .6, coreMoods: [], bpmMin: "", bpmMax: "", energyMin: "", energyMax: "", discoveryPreference: .5, lockedKeys: [] });
  const identity = data?.identity;
  const profile = identity?.effectiveProfileJson || {};
  const load = async () => {
    setBusy("Loading identity"); setError("");
    try {
      const response = await axios.get(`/api/playlists/${playlistId}/identity`);
      setData(response.data);
      const next = response.data.identity;
      const effective = next?.effectiveProfileJson || {};
      setForm({
        enabled: next?.enabled ?? true, learningEnabled: next?.learningEnabled ?? true,
        preservationMode: next?.preservationMode || "BALANCED", strength: next?.strength ?? .6,
        coreMoods: effective.coreMoods || [], bpmMin: effective.bpmRange?.[0] ?? "", bpmMax: effective.bpmRange?.[1] ?? "",
        energyMin: effective.energyRange?.[0] ?? "", energyMax: effective.energyRange?.[1] ?? "",
        discoveryPreference: effective.discoveryPreference ?? .5,
        lockedKeys: (next?.attributes || []).filter((item: any) => item.locked).map((item: any) => item.key),
      });
    } catch (requestError: any) { setError(requestError.response?.data?.error || "Unable to load playlist identity."); }
    finally { setBusy(""); }
  };
  useEffect(() => { if (opened && !data) { load(); axios.get("/api/mood-tags").then((response) => setMoods((response.data.moods || response.data.tags || []).map((item: any) => typeof item === "string" ? item : item.name))).catch(() => undefined); } }, [opened]); // eslint-disable-line react-hooks/exhaustive-deps
  const stats = useMemo(() => ({
    important: (identity?.trackMemories || []).filter((item: any) => item.importance !== "NORMAL").length,
    rejected: (identity?.trackMemories || []).filter((item: any) => item.rejectionState !== "NONE").length,
  }), [identity]);
  const save = async () => {
    setBusy("Saving identity"); setError("");
    try {
      const userProfile: any = { coreMoods: form.coreMoods, discoveryPreference: Number(form.discoveryPreference) };
      if (form.bpmMin !== "" && form.bpmMax !== "") userProfile.bpmRange = [Number(form.bpmMin), Number(form.bpmMax)];
      if (form.energyMin !== "" && form.energyMax !== "") userProfile.energyRange = [Number(form.energyMin), Number(form.energyMax)];
      const response = await axios.patch(`/api/playlists/${playlistId}/identity`, { enabled: form.enabled, learningEnabled: form.learningEnabled, preservationMode: form.preservationMode, strength: Number(form.strength), userProfile, lockedKeys: form.lockedKeys });
      setData(response.data); setEditing(false); setMessage("Playlist identity saved.");
    } catch (requestError: any) { setError(requestError.response?.data?.error || "Unable to save playlist identity."); }
    finally { setBusy(""); }
  };
  const retrain = async () => { setBusy("Retraining identity"); setError(""); try { const response = await axios.post(`/api/playlists/${playlistId}/identity/retrain`); setData(response.data); setMessage("Identity retrained with a before-and-after snapshot."); } catch (requestError: any) { setError(requestError.response?.data?.error || "Unable to retrain identity."); } finally { setBusy(""); } };
  const reset = async () => { if (!window.confirm("Reset learned playlist identity? Playlist tracks and manual settings will be preserved.")) return; setBusy("Resetting identity"); try { await axios.post(`/api/playlists/${playlistId}/identity/reset`, { scope: "LEARNED", confirm: true }); setData(null); await load(); setMessage("Learned identity reset. Playlist tracks were not changed."); } catch (requestError: any) { setError(requestError.response?.data?.error || "Unable to reset identity."); } finally { setBusy(""); } };
  const clone = async () => { const name = window.prompt("Name the new independent playlist identity:", `${playlistName} — Identity Clone`); if (!name) return; setBusy("Cloning identity"); try { await axios.post(`/api/playlists/${playlistId}/identity/clone`, { name, includeImportantTracks: true, includeLockedTracks: true, includeRejections: false }); setMessage(`Cloned identity into "${name}".`); onClone?.(); } catch (requestError: any) { setError(requestError.response?.data?.error || "Unable to clone identity."); } finally { setBusy(""); } };
  const updateMemory = async (item: any, importance: string) => { setBusy(`Updating ${item.track.title}`); try { await axios.patch(`/api/playlists/${playlistId}/identity/tracks/${item.trackId}`, { importance }); await load(); } catch (requestError: any) { setError(requestError.response?.data?.error || "Unable to update track importance."); } finally { setBusy(""); } };
  const toggleMood = (mood: string) => setForm((current: any) => ({ ...current, coreMoods: current.coreMoods.includes(mood) ? current.coreMoods.filter((item: string) => item !== mood) : [...current.coreMoods, mood].slice(0, 8) }));
  const toggleLock = (key: string) => setForm((current: any) => ({ ...current, lockedKeys: current.lockedKeys.includes(key) ? current.lockedKeys.filter((item: string) => item !== key) : [...current.lockedKeys, key] }));

  return <details className={styles.panel} onToggle={(event) => setOpened((event.currentTarget as HTMLDetailsElement).open)}>
    <summary><Brain size={15} /> Playlist Identity <span>{identity ? confidenceLabel(identity.confidenceState) : "Open to initialize"}</span></summary>
    <div className={styles.body}>
      {busy && <div className={styles.notice}><RefreshCw size={13} className="animate-spin" /> {busy}</div>}
      {message && <div className={styles.notice}>{message}</div>}{error && <div className={styles.error}>{error}</div>}
      {!data && !busy ? <button onClick={load}>Initialize playlist identity</button> : identity && <>
        <div className={styles.headline}><div><h4>{data.summary?.title || playlistName}</h4><p>{data.summary?.explanation}</p></div><div className={styles.confidence}><strong>{confidenceLabel(identity.confidenceState)}</strong><small>{Math.round(identity.confidence * 100)}% confidence</small></div></div>
        <p className={styles.summary}>{data.summary?.coreMood} · {data.summary?.preferredBpm} · {data.summary?.energy}</p>
        <div className={styles.grid}>
          <div><span>Preservation</span><strong>{confidenceLabel(identity.preservationMode)}</strong></div><div><span>Discovery</span><strong>{data.summary?.discovery}</strong></div>
          <div><span>Important / anchor</span><strong>{stats.important}</strong></div><div><span>Rejected memory</span><strong>{stats.rejected}</strong></div>
          <div><span>Historical tracks</span><strong>{identity.historicalTrackCount}</strong></div><div><span>Training samples</span><strong>{identity.trainingSampleCount}</strong></div>
        </div>
        {Object.keys(profile.moodDistribution || {}).length > 0 && <div className={styles.bars} aria-label="Mood distribution">{Object.entries(profile.moodDistribution).slice(0, 5).map(([name, value]: any) => <div className={styles.bar} key={name}><span>{name}</span><i style={{ width: `${Math.max(4, value * 100)}%` }} /><b>{Math.round(value * 100)}%</b></div>)}</div>}
        <div className={styles.actions}><button onClick={() => setEditing(!editing)}><Edit3 size={13} /> Edit identity</button><button onClick={retrain} disabled={Boolean(busy)}><RefreshCw size={13} /> Retrain</button><button onClick={clone} disabled={Boolean(busy)}><Copy size={13} /> Clone</button><button onClick={reset} disabled={Boolean(busy)}><RotateCcw size={13} /> Reset learned</button></div>
        {editing && <div className={styles.editor}><h5>Effective identity preview</h5>
          <div className={styles.toggles}><label><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /> Identity enabled</label><label><input type="checkbox" checked={form.learningEnabled} onChange={(event) => setForm({ ...form, learningEnabled: event.target.checked })} /> Automatic learning</label></div>
          <div className={styles.fields}><label>Preservation mode<select value={form.preservationMode} onChange={(event) => setForm({ ...form, preservationMode: event.target.value })}><option value="FLEXIBLE">Flexible</option><option value="BALANCED">Balanced</option><option value="STRONG">Strong</option><option value="STRICT">Strict</option></select></label><label>Identity strength: {Math.round(form.strength * 100)}%<input type="range" min="0" max="1" step=".05" value={form.strength} onChange={(event) => setForm({ ...form, strength: Number(event.target.value) })} /></label><label>BPM minimum<input type="number" min="20" max="300" value={form.bpmMin} onChange={(event) => setForm({ ...form, bpmMin: event.target.value })} /></label><label>BPM maximum<input type="number" min="20" max="300" value={form.bpmMax} onChange={(event) => setForm({ ...form, bpmMax: event.target.value })} /></label><label>Energy minimum<input type="number" min="0" max="1" step=".05" value={form.energyMin} onChange={(event) => setForm({ ...form, energyMin: event.target.value })} /></label><label>Energy maximum<input type="number" min="0" max="1" step=".05" value={form.energyMax} onChange={(event) => setForm({ ...form, energyMax: event.target.value })} /></label><label>Discovery: {Math.round(form.discoveryPreference * 100)}%<input type="range" min="0" max="1" step=".05" value={form.discoveryPreference} onChange={(event) => setForm({ ...form, discoveryPreference: Number(event.target.value) })} /></label></div>
          <div><small>Core moods</small><div className={styles.moods}>{moods.slice(0, 30).map((mood) => <label key={mood}><input type="checkbox" checked={form.coreMoods.includes(mood)} onChange={() => toggleMood(mood)} /> {mood}</label>)}</div></div>
          <div><small>Lock characteristics</small><div className={styles.moods}>{lockable.map((key) => <label key={key}><input type="checkbox" checked={form.lockedKeys.includes(key)} onChange={() => toggleLock(key)} /> {key.replace(/([A-Z])/g, " $1")}</label>)}</div></div>
          <div className={styles.actions}><button onClick={save} disabled={Boolean(busy)}><Save size={13} /> Save effective identity</button></div>
        </div>}
        {identity.trackMemories?.length > 0 && <details><summary><ShieldCheck size={13} /> Important and rejected tracks</summary><div className={styles.memory}>{identity.trackMemories.slice(0, 20).map((item: any) => <article key={item.id}><div><strong>{item.track.title}</strong><small>{item.track.artist?.title} · {item.rejectionState !== "NONE" ? item.rejectionState.replaceAll("_", " ") : item.importance}</small></div><select aria-label={`Importance for ${item.track.title}`} value={item.importance} onChange={(event) => updateMemory(item, event.target.value)}><option value="NORMAL">Normal</option><option value="PREFERRED">Preferred</option><option value="IMPORTANT">Important</option><option value="ANCHOR">Anchor</option><option value="LOCKED">Locked</option></select></article>)}</div></details>}
      </>}
    </div>
  </details>;
}
