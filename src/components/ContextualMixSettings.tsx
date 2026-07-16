"use client";

import { useEffect, useState } from "react";
import axios from "axios";

export default function ContextualMixSettings() {
  const [settings, setSettings] = useState<any>(null);
  const [status, setStatus] = useState("");
  useEffect(() => { axios.get("/api/contextual-mixes/settings").then((response) => setSettings(response.data.settings)).catch(() => setStatus("Context settings could not be loaded.")); }, []);
  if (!settings) return <p>{status || "Loading context settings…"}</p>;
  const update = (key: string, value: any) => setSettings((current: any) => ({ ...current, [key]: value }));
  const save = async () => { setStatus("Saving…"); try { const response = await axios.put("/api/contextual-mixes/settings", settings); setSettings(response.data.settings); setStatus("Context settings saved."); } catch (error: any) { setStatus(error.response?.data?.error || "Context settings could not be saved."); } };
  return <div style={{ display: "grid", gap: ".7rem" }}>
    {[
      ["enabled", "Enable Contextual Mixes"], ["showSuggestions", "Show contextual suggestions"], ["showBuiltInCards", "Show built-in context cards"], ["showCustomCards", "Show custom context cards"], ["autoSuggestTimeAndDay", "Suggest contexts from local time and day"], ["confirmBeforeReplacingManual", "Confirm before replacing manually changed settings"],
    ].map(([key, label]) => <label key={key} style={{ display: "flex", alignItems: "center", gap: ".55rem" }}><input type="checkbox" checked={Boolean(settings[key])} onChange={(event) => update(key, event.target.checked)} /> {label}</label>)}
    <label style={{ display: "grid", gap: ".3rem" }}>Default context influence<select value={settings.defaultInfluence} onChange={(event) => update("defaultInfluence", event.target.value)} style={{ minHeight: 40, borderRadius: 8, background: "var(--panel, #10182c)", color: "inherit", padding: ".5rem" }}><option value="LOW">Low</option><option value="BALANCED">Balanced</option><option value="STRONG">Strong</option></select></label>
    <label style={{ display: "grid", gap: ".3rem" }}>Timezone for suggestions<input value={settings.timeZone || ""} placeholder="America/New_York" onChange={(event) => update("timeZone", event.target.value)} style={{ minHeight: 40, borderRadius: 8, background: "var(--panel, #10182c)", color: "inherit", padding: ".5rem" }} /><small>Used only for optional time/day suggestions. No location lookup is performed.</small></label>
    <div><button type="button" onClick={save} style={{ minHeight: 40, padding: ".55rem .8rem", borderRadius: 8, cursor: "pointer" }}>Save contextual settings</button>{status && <span role="status" style={{ marginLeft: ".7rem" }}>{status}</span>}</div>
  </div>;
}
