"use client";
import axios from "axios";
import { useEffect, useState } from "react";

const defaults = { enabled: true, defaultDurationType: "DAYS", defaultDurationTarget: 7, defaultPublicationMode: "PREVIEW_ONLY", minimumPlaybackSessions: 3, minimumTrackInteractions: 10, minimumDurationHours: 24, minimumResultDifference: 5, minimumConfidence: "LOW", allowPlaybackMetrics: true, automaticallyEvaluate: true, automaticallyPauseMissingPlaylists: true, historyRetentionDays: null, showAdvancedControls: false, allowMultiVariableExperiments: true, notificationsEnabled: true };
export default function SmartExperimentSettings() {
  const [form, setForm] = useState<any>(defaults); const [status, setStatus] = useState("");
  useEffect(() => { axios.get("/api/settings/smart-experiments").then((response) => setForm({ ...defaults, ...response.data })).catch(() => setStatus("Smart Experiment settings are unavailable until the v2.2.6 migration is applied.")); }, []);
  const check = (key: string, label: string) => <label style={{display:"flex",gap:".55rem",alignItems:"center"}}><input type="checkbox" checked={Boolean(form[key])} onChange={(event) => setForm({ ...form, [key]: event.target.checked })}/><span>{label}</span></label>;
  async function save() { setStatus("Saving…"); try { const response = await axios.patch("/api/settings/smart-experiments", Object.fromEntries(Object.keys(defaults).map((key) => [key, form[key]]))); setForm({ ...defaults, ...response.data }); setStatus("Smart Experiment settings saved. Winners are never applied automatically."); } catch (caught: any) { setStatus(caught.response?.data?.error?.message || "Settings could not be saved."); } }
  return <div style={{display:"grid",gap:"1rem"}}>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(250px,1fr))",gap:".7rem"}}>{check("enabled","Enable Smart Experiments")}{check("allowPlaybackMetrics","Allow local playback-based signals")}{check("automaticallyEvaluate","Automatically evaluate available evidence")}{check("automaticallyPauseMissingPlaylists","Pause when published playlists are missing")}{check("notificationsEnabled","Experiment notifications")}{check("showAdvancedControls","Show advanced controls")}{check("allowMultiVariableExperiments","Allow multi-variable experiments")}</div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:".7rem"}}>
      <label>Default duration<select value={form.defaultDurationType} onChange={(event)=>setForm({...form,defaultDurationType:event.target.value})}><option value="DAYS">Days</option><option value="SESSIONS">Sessions</option><option value="INTERACTIONS">Interactions</option><option value="MANUAL">Manual</option></select></label>
      <label>Default target<input type="number" min="1" value={form.defaultDurationTarget} onChange={(event)=>setForm({...form,defaultDurationTarget:Number(event.target.value)})}/></label>
      <label>Publication<select value={form.defaultPublicationMode} onChange={(event)=>setForm({...form,defaultPublicationMode:event.target.value})}><option value="PREVIEW_ONLY">Preview only</option><option value="SEPARATE_PLEX_PLAYLISTS">Separate Plex playlists</option><option value="ALTERNATING_ACTIVE">Alternating (experimental)</option></select></label>
      <label>Minimum sessions<input type="number" min="0" value={form.minimumPlaybackSessions} onChange={(event)=>setForm({...form,minimumPlaybackSessions:Number(event.target.value)})}/></label>
      <label>Minimum interactions<input type="number" min="0" value={form.minimumTrackInteractions} onChange={(event)=>setForm({...form,minimumTrackInteractions:Number(event.target.value)})}/></label>
      <label>Minimum hours<input type="number" min="0" value={form.minimumDurationHours} onChange={(event)=>setForm({...form,minimumDurationHours:Number(event.target.value)})}/></label>
      <label>Minimum result difference<input type="number" min="0" max="100" value={form.minimumResultDifference} onChange={(event)=>setForm({...form,minimumResultDifference:Number(event.target.value)})}/></label>
      <label>History retention<select value={form.historyRetentionDays ?? ""} onChange={(event)=>setForm({...form,historyRetentionDays:event.target.value ? Number(event.target.value) : null})}><option value="">Keep indefinitely</option><option value="90">90 days</option><option value="180">180 days</option><option value="365">One year</option></select></label>
    </div>
    <p style={{color:"var(--text-secondary)",margin:0}}>Experiment data stays local. Playback can be disabled; generation scores and explicit feedback still work. Playback behavior is a recommendation signal, never definitive judgment.</p><div><button type="button" onClick={() => void save()}>Save Smart Experiment settings</button> <span role="status">{status}</span></div>
  </div>;
}
