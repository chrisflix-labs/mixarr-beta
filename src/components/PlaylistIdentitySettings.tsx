"use client";

import { useEffect, useState } from "react";
import axios from "axios";

export default function PlaylistIdentitySettings() {
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(true);
  const [saved, setSaved] = useState(false);
  useEffect(() => { axios.get("/api/settings/playlist-identity").then((response) => setEnabled(response.data.learningEnabled !== false)).finally(() => setBusy(false)); }, []);
  const save = async (next: boolean) => {
    setEnabled(next); setBusy(true); setSaved(false);
    try { await axios.patch("/api/settings/playlist-identity", { learningEnabled: next }); setSaved(true); window.setTimeout(() => setSaved(false), 1800); }
    finally { setBusy(false); }
  };
  return <div style={{ display: "grid", gap: ".7rem" }}>
    <label style={{ display: "flex", alignItems: "flex-start", gap: ".7rem", padding: ".85rem", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", background: "rgba(255,255,255,.035)" }}>
      <input type="checkbox" checked={enabled} disabled={busy} onChange={(event) => save(event.target.checked)} />
      <span><strong style={{ display: "block" }}>Enable playlist identity learning globally</strong><small style={{ color: "var(--text-muted)", lineHeight: 1.45 }}>When off, stored identities remain available and can still be edited or manually retrained, but automatic generation, regeneration, feedback, and restore training pauses.</small></span>
    </label>
    {saved && <small style={{ color: "var(--success)" }}>Playlist identity learning preference saved.</small>}
  </div>;
}
