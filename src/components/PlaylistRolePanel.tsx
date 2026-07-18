"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { BadgeInfo, Copy, RotateCcw, Save, Tags, Trash2 } from "lucide-react";
import styles from "./PlaylistRolePanel.module.css";

export default function PlaylistRolePanel({ playlistId }: { playlistId: string }) {
  const [roles, setRoles] = useState<any[]>([]); const [assignment, setAssignment] = useState<any>(null); const [playlists, setPlaylists] = useState<any[]>([]);
  const [roleId, setRoleId] = useState(""); const [behaviorMode, setBehaviorMode] = useState("SUGGEST"); const [customName, setCustomName] = useState(""); const [copyFrom, setCopyFrom] = useState("");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [roleResponse, assignmentResponse, playlistResponse] = await Promise.all([
      axios.get("/api/playlist-roles"), axios.get(`/api/playlist-roles/assignments/${playlistId}`), axios.get("/api/generated-playlists"),
    ]);
    const nextAssignment = assignmentResponse.data.assignment;
    setRoles(roleResponse.data.roles || []); setAssignment(nextAssignment); setPlaylists((playlistResponse.data.playlists || []).filter((playlist: any) => playlist.id !== playlistId));
    setRoleId(nextAssignment?.roleDefinitionId || ""); setBehaviorMode(nextAssignment?.behaviorMode || "SUGGEST"); setCustomName(nextAssignment?.customRoleName || "");
  }, [playlistId]);

  useEffect(() => { load().catch(() => setError("Playlist roles are unavailable.")); }, [load]);
  const selected = useMemo(() => roles.find((role) => role.id === roleId), [roles, roleId]);

  async function action(run: () => Promise<any>, success: string) {
    setBusy(true); setError(""); setMessage("");
    try { await run(); await load(); setMessage(success); } catch (caught: any) { setError(caught.response?.data?.error?.message || caught.response?.data?.error || caught.message || "Role update failed."); } finally { setBusy(false); }
  }

  return <details className={styles.panel}>
    <summary><span><Tags size={17} /> Playlist role</span><strong>{assignment ? assignment.customRoleName || assignment.roleDefinition.name : "Not assigned"}</strong></summary>
    <div className={styles.body}>
      <p>Roles describe this playlist’s purpose. “Suggest settings” is advisory and remains the safe default.</p>
      <div className={styles.grid}>
        <label>Role<select value={roleId} onChange={(event) => setRoleId(event.target.value)} disabled={busy}><option value="">No role</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
        <label>Role behavior<select value={behaviorMode} onChange={(event) => setBehaviorMode(event.target.value)} disabled={busy}><option value="LABEL_ONLY">Label only</option><option value="SUGGEST">Suggest settings</option><option value="APPLY">Apply guidance during generation</option></select></label>
        {selected?.key === "custom" && <label>Custom role name<input value={customName} onChange={(event) => setCustomName(event.target.value)} maxLength={80} placeholder="Late-night bridge" /></label>}
      </div>
      {selected && <div className={styles.recommendation}><BadgeInfo size={16} /><div><strong>Recommended guidance</strong><span>Energy {selected.guidance.energyStart == null ? "Flexible" : `${Math.round(selected.guidance.energyStart * 100)} → ${Math.round(selected.guidance.energyEnd * 100)}`} · BPM {selected.guidance.bpmMin || "Flexible"}{selected.guidance.bpmMax ? `–${selected.guidance.bpmMax}` : ""} · Discovery {Math.round((selected.guidance.discoveryLevel || 0) * 100)}%</span><small>{selected.description}</small></div></div>}
      {assignment?.differences?.length > 0 && <p className={styles.differences}>Customized fields: {assignment.differences.join(", ")}</p>}
      <div className={styles.actions}>
        <button disabled={busy || !roleId} onClick={() => action(() => axios.put(`/api/playlist-roles/assignments/${playlistId}`, { roleDefinitionId: roleId, behaviorMode, customRoleName: selected?.key === "custom" ? customName : null, settingsOverride: assignment?.settingsOverrideJson || {} }), "Playlist role saved.")}><Save size={15} /> Save role</button>
        {assignment && <button disabled={busy} onClick={() => action(() => axios.post(`/api/playlist-roles/assignments/${playlistId}`, { action: "restore_defaults" }), "Recommended defaults restored.")}><RotateCcw size={15} /> Restore defaults</button>}
        {assignment && <button className={styles.danger} disabled={busy} onClick={() => action(() => axios.delete(`/api/playlist-roles/assignments/${playlistId}`), "Playlist role removed.")}><Trash2 size={15} /> Remove</button>}
      </div>
      {playlists.length > 0 && <div className={styles.copyRow}><select value={copyFrom} onChange={(event) => setCopyFrom(event.target.value)}><option value="">Copy role from…</option>{playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.plexPlaylistTitle}</option>)}</select><button disabled={busy || !copyFrom} onClick={() => action(() => axios.post(`/api/playlist-roles/assignments/${playlistId}`, { action: "copy", sourcePlaylistId: copyFrom }), "Role settings copied.")}><Copy size={15} /> Copy</button></div>}
      {message && <p className={styles.success} role="status">{message}</p>}{error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  </details>;
}
