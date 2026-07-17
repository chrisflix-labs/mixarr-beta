"use client";

import axios from "axios";
import { useEffect, useState } from "react";

const defaults = { enabled: true, detailLevel: "SIMPLE", rejectedCandidateLimit: 100, rejectedRetentionDays: 30 };

export default function SmartMixExplanationSettings() {
  const [settings, setSettings] = useState(defaults);
  const [developerAvailable, setDeveloperAvailable] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { axios.get("/api/settings/smart-mix-explanations").then((response) => { setSettings(response.data.preference); setDeveloperAvailable(response.data.developerModeAvailable); }).catch(() => setError("Explanation settings are unavailable. Apply the v2.1.8 migration and retry.")); }, []);
  async function save() { try { const response = await axios.patch("/api/settings/smart-mix-explanations", settings); setSettings(response.data.preference); setMessage("Smart Mix explanation settings saved."); setError(""); } catch (requestError: any) { setError(requestError.response?.data?.error || "Explanation settings could not be saved."); } }
  async function cleanup() { try { const response = await axios.post("/api/smart-mix-explanations/cleanup"); setMessage(`Removed ${response.data.deletedTraces} expired candidate trace${response.data.deletedTraces === 1 ? "" : "s"}.`); setError(""); } catch { setError("Expired traces could not be cleaned up."); } }
  const fieldStyle = { display: "grid", gap: ".35rem", margin: ".75rem 0", maxWidth: 420 } as const;
  const controlStyle = { minHeight: 38, background: "#111827", color: "var(--fg)", border: "1px solid var(--line)", borderRadius: 6, padding: "0 .5rem" } as const;
  return <div>
    <label style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: ".6rem", alignItems: "start", padding: ".7rem 0" }}><input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })}/><span><strong style={{display:"block"}}>Capture Smart Mix v2 explanations</strong><small style={{color:"var(--muted)"}}>Selected tracks are retained with version history. Rejected candidate details use bounded temporary storage.</small></span></label>
    <label style={fieldStyle}><strong>Default detail level</strong><select style={controlStyle} value={settings.detailLevel} onChange={(event) => setSettings({ ...settings, detailLevel: event.target.value })}><option value="SIMPLE">Simple</option><option value="DETAILED">Detailed</option>{developerAvailable && <option value="DEVELOPER">Developer</option>}</select><small style={{color:"var(--muted)"}}>Developer mode exposes stable codes and raw scoring values and is restricted to administrators.</small></label>
    <label style={fieldStyle}><strong>Rejected candidate details per generation</strong><input style={controlStyle} type="number" min={0} max={500} value={settings.rejectedCandidateLimit} onChange={(event) => setSettings({ ...settings, rejectedCandidateLimit: Number(event.target.value) })}/></label>
    <label style={fieldStyle}><strong>Rejected trace retention (days)</strong><input style={controlStyle} type="number" min={1} max={365} value={settings.rejectedRetentionDays} onChange={(event) => setSettings({ ...settings, rejectedRetentionDays: Number(event.target.value) })}/></label>
    <p style={{color:"var(--muted)",fontSize:".82rem"}}>Explanation data stays in Mixarr&apos;s database and can reveal listening preferences and feedback patterns. Debug exports are sanitized but should still be reviewed before sharing.</p>
    <div style={{display:"flex",gap:".55rem",flexWrap:"wrap"}}><button type="button" onClick={save} style={{minHeight:38,padding:".55rem .8rem",border:0,borderRadius:6,color:"#fff",background:"var(--accent)",fontWeight:800,cursor:"pointer"}}>Save explanation settings</button><button type="button" onClick={cleanup} style={{minHeight:38,padding:".55rem .8rem",border:"1px solid var(--line)",borderRadius:6,color:"var(--fg)",background:"#111827",fontWeight:700,cursor:"pointer"}}>Delete expired traces now</button></div>
    {message && <p style={{color:"#baf8c9"}} role="status">{message}</p>}{error && <p style={{color:"#ffd6d6"}} role="alert">{error}</p>}
  </div>;
}
