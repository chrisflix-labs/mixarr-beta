"use client";

import axios from "axios";
import { useEffect, useState } from "react";

const defaults = { playlistVersionHistoryEnabled: true, playlistVersionRetention: 25, saveManualPlaylistVersions: true, savePlaylistScoreSnapshots: true, cleanupPlaylistVersionsAutomatically: false };

export default function PlaylistVersionSettings() {
  const [settings, setSettings] = useState(defaults);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { axios.get("/api/settings/playlist-versions").then((response) => setSettings(response.data.settings)).catch(() => setError("Version history settings are unavailable.")); }, []);
  function checkbox(key: keyof typeof defaults, label: string, description: string) {
    return <label style={{display:"grid",gridTemplateColumns:"auto 1fr",gap:".6rem",alignItems:"start",padding:".7rem 0"}}><input type="checkbox" checked={Boolean(settings[key])} onChange={(event) => setSettings({...settings,[key]:event.target.checked})}/><span><strong style={{display:"block"}}>{label}</strong><small style={{color:"var(--muted)"}}>{description}</small></span></label>;
  }
  async function save() {
    if (!settings.playlistVersionHistoryEnabled && !window.confirm("Turn off playlist version history? Future changes will not be recoverable. Existing versions will be kept.")) return;
    try { await axios.put("/api/settings/playlist-versions", settings); setMessage("Playlist version settings saved."); setError(""); }
    catch (requestError: any) { setError(requestError.response?.data?.error || "Settings could not be saved."); }
  }
  return <div>
    {checkbox("playlistVersionHistoryEnabled","Enable playlist version history","Existing versions are kept if this is turned off. Restore safety snapshots are always retained.")}
    {checkbox("saveManualPlaylistVersions","Save versions for manual edits","Batch related edits into one version when the edit is committed.")}
    {checkbox("savePlaylistScoreSnapshots","Save score snapshots","Historical scores remain unchanged when scoring logic evolves.")}
    {checkbox("cleanupPlaylistVersionsAutomatically","Automatically clean up old versions","Off by default. Pinned, current, initial, and restore-related versions are protected.")}
    <label style={{display:"grid",gap:".35rem",margin:".65rem 0"}}><strong>Version retention</strong><select value={settings.playlistVersionRetention} onChange={(event)=>setSettings({...settings,playlistVersionRetention:Number(event.target.value)})} style={{maxWidth:260,minHeight:38,background:"#111827",color:"var(--fg)",border:"1px solid var(--line)",borderRadius:6,padding:"0 .5rem"}}><option value={10}>Keep the last 10 versions</option><option value={25}>Keep the last 25 versions</option><option value={50}>Keep the last 50 versions</option><option value={100}>Keep the last 100 versions</option></select></label>
    <button type="button" onClick={save} style={{minHeight:38,padding:".55rem .8rem",border:0,borderRadius:6,color:"#fff",background:"var(--accent)",fontWeight:800,cursor:"pointer"}}>Save version settings</button>
    {message && <p style={{color:"#baf8c9"}} role="status">{message}</p>}{error && <p style={{color:"#ffd6d6"}} role="alert">{error}</p>}
  </div>;
}

