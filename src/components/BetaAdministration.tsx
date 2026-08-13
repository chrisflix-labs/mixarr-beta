"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { CheckCircle2, Copy, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import styles from "@/app/settings/settings.module.css";
import { copyTextToClipboard } from "@/lib/clipboard";

type Definition = { key: string; name: string; description: string; category: string; minimumAccessLevel: string; adminOnly: boolean; riskLevel: string; warningText: string; runtimeSupported: boolean };
type Override = { featureKey: string; enabled: boolean; forceDisabled: boolean; userSelectable: boolean };
type User = { id: string; username: string; isAdmin: boolean };
type Access = { userId: string; accessLevel: string; expiresAt: string | null; notes?: string | null };
type AdminPayload = { serverAccessLevel: string; sponsorsCardHidden: boolean; definitions: Definition[]; overrides: Override[]; users: User[]; access: Access[] };

export default function BetaAdministration() {
  const [payload, setPayload] = useState<AdminPayload | null>(null);
  const [usage, setUsage] = useState<any>(null);
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [accessDrafts, setAccessDrafts] = useState<Record<string, { accessLevel: string; expiresAt: string; notes: string }>>({});
  const [loadError, setLoadError] = useState("");
  const failureText = (caught: unknown, fallback: string) => (caught as any)?.response?.data?.error || (caught as any)?.response?.data?.message || fallback;
  const load = async () => {
    try {
      const [features, usageResponse] = await Promise.all([axios.get("/api/admin/beta/features"), axios.get("/api/admin/beta/usage")]);
      setPayload(features.data); setUsage(usageResponse.data); setLoadError("");
      setAccessDrafts(Object.fromEntries(features.data.users.map((user: User) => { const access = features.data.access.find((item: Access) => item.userId === user.id); return [user.id, { accessLevel: access?.accessLevel || "STABLE", expiresAt: access?.expiresAt ? String(access.expiresAt).slice(0, 10) : "", notes: access?.notes || "" }]; })));
    } catch (caught) {
      // Without this the panel showed its loading spinner forever whenever the
      // administrative endpoints returned 403 or an error.
      setLoadError(failureText(caught, "Beta administration could not be loaded. Confirm you are signed in as an administrator and try again."));
    }
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const overrideFor = (key: string) => payload?.overrides.find((item) => item.featureKey === key);
  // Every mutation clears `working` in `finally` and reports the failure, so a
  // rejected save can no longer leave its controls permanently disabled and
  // silently unsaved.
  const updateFeature = async (definition: Definition, patch: Partial<Override>) => {
    setWorking(definition.key); setMessage(""); setActionError("");
    const current = overrideFor(definition.key);
    try {
      await axios.put("/api/admin/beta/features", { action: "feature", featureKey: definition.key, enabled: current?.enabled ?? true, forceDisabled: current?.forceDisabled ?? false, userSelectable: current?.userSelectable ?? true, ...patch });
      await load(); setMessage(`${definition.name} updated.`);
    } catch (caught) { setActionError(failureText(caught, `${definition.name} could not be updated. The previous setting is unchanged.`)); await load(); }
    finally { setWorking(""); }
  };
  const updateAccess = async (userId: string) => {
    const draft = accessDrafts[userId];
    setWorking(`user:${userId}`); setMessage(""); setActionError("");
    try {
      await axios.put("/api/admin/beta/features", { action: "access", userId, accessLevel: draft.accessLevel, expiresAt: draft.expiresAt || null, notes: draft.notes });
      await load(); setMessage("Beta access updated.");
    } catch (caught) { setActionError(failureText(caught, "Beta access could not be updated. The previous access level is unchanged.")); }
    finally { setWorking(""); }
  };
  const toggleSponsorsCard = async (hidden: boolean) => {
    setWorking("sponsors"); setMessage(""); setActionError("");
    try { await axios.put("/api/admin/beta/features", { action: "sponsors", hidden }); await load(); setMessage("Sponsors card visibility updated."); }
    catch (caught) { setActionError(failureText(caught, "The sponsors card setting could not be saved.")); }
    finally { setWorking(""); }
  };
  const copyDiagnostics = async () => {
    setMessage(""); setActionError("");
    try { await copyTextToClipboard(JSON.stringify({ serverAccessLevel: payload?.serverAccessLevel, overrides: payload?.overrides, usage }, null, 2)); setMessage("Sanitized beta administration summary copied."); }
    catch { setActionError("Your browser blocked automatic copying. Read and copy the values from this page."); }
  };
  if (loadError && !payload) return <div className={styles.betaWarning}><ShieldAlert size={17} /><span>{loadError} <button type="button" className={styles.secondaryButton} onClick={() => void load()}>Retry</button></span></div>;
  if (!payload) return <div className={styles.betaLoading}><Loader2 size={16} className={styles.spinIcon} /> Loading beta administration...</div>;
  return <div className={styles.betaSettings}>
    <div className={styles.betaWarning}><ShieldAlert size={17} /><span>Server beta level: <strong>{payload.serverAccessLevel.replaceAll("_", " ")}</strong>. Environment limits and emergency switches always override these controls.</span></div>
    <div className={styles.schedulerStatusGrid}>
      <div className={styles.schedulerStatusCard}><span>Experimental actions</span><strong>{usage?.total || 0}</strong><small>{usage?.successful || 0} successful</small></div>
      <div className={styles.schedulerStatusCard}><span>Stable fallbacks</span><strong>{usage?.fallbacks || 0}</strong><small>{usage?.failed || 0} failed before completion</small></div>
      <div className={styles.schedulerStatusCard}><span>Beta playlists</span><strong>{usage?.betaPlaylists || 0}</strong><small>Playlist history is preserved after revocation</small></div>
      <div className={styles.schedulerStatusCard}><span>Active overrides</span><strong>{payload.overrides.length}</strong><small>{payload.overrides.filter((item) => item.forceDisabled).length} emergency-disabled</small></div>
    </div>

    <h3>Available Feature Flags</h3>
    <div className={styles.betaFlagList}>{payload.definitions.map((definition) => {
      const override = overrideFor(definition.key); const busy = working === definition.key;
      return <div key={definition.key} className={styles.betaFlagRow}>
        <input aria-label={`Enable ${definition.name}`} type="checkbox" checked={definition.runtimeSupported && (override?.enabled ?? true)} disabled={busy || !definition.runtimeSupported} onChange={(event) => void updateFeature(definition, { enabled: event.target.checked })} />
        <span><strong>{definition.name}</strong><small>{definition.key}</small><small>{definition.description}</small><small>{definition.runtimeSupported ? `${definition.minimumAccessLevel.replaceAll("_", " ")} · Risk ${definition.riskLevel}${definition.adminOnly ? " · ADMIN ONLY" : ""}` : "Registry reservation · not implemented in this build"}</small>{definition.runtimeSupported && <><label><input type="checkbox" checked={override?.userSelectable ?? true} disabled={busy} onChange={(event) => void updateFeature(definition, { userSelectable: event.target.checked })} /> User selectable</label><label><input type="checkbox" checked={override?.forceDisabled ?? false} disabled={busy} onChange={(event) => void updateFeature(definition, { forceDisabled: event.target.checked })} /> Emergency force-disable</label></>}</span>
        <em>{busy ? "SAVING" : !definition.runtimeSupported ? "UNAVAILABLE" : definition.minimumAccessLevel === "PRIVATE_BETA" ? "PRIVATE BETA" : "BETA"}</em>
      </div>;
    })}</div>

    <h3>Private Beta Access</h3>
    <div className={styles.betaFlagList}>{payload.users.map((user) => {
      const draft = accessDrafts[user.id] || { accessLevel: "STABLE", expiresAt: "", notes: "" };
      const setDraft = (patch: Partial<typeof draft>) => setAccessDrafts((current) => ({ ...current, [user.id]: { ...draft, ...patch } }));
      return <div key={user.id} className={styles.betaFlagRow}><span /><span><strong>{user.username}{user.isAdmin ? " · Administrator" : ""}</strong><small>Granting access never enables individual flags or bypasses the server maximum. Notes are administrator-only.</small><input className={styles.input} placeholder="Internal note" maxLength={500} value={draft.notes} onChange={(event) => setDraft({ notes: event.target.value })} /><input className={styles.input} type="date" aria-label={`Access expiration for ${user.username}`} value={draft.expiresAt} onChange={(event) => setDraft({ expiresAt: event.target.value })} /></span><span><select className={styles.input} value={draft.accessLevel} disabled={working === `user:${user.id}`} onChange={(event) => setDraft({ accessLevel: event.target.value })}><option value="STABLE">Stable</option><option value="PUBLIC_BETA">Public Beta</option><option value="PRIVATE_BETA">Private Beta</option>{payload.serverAccessLevel === "DEVELOPER" && <option value="DEVELOPER">Developer</option>}</select><button className={styles.secondaryButton} type="button" disabled={working === `user:${user.id}`} onClick={() => void updateAccess(user.id)}>Save access</button></span></div>;
    })}</div>

    <label className={styles.toggleRow}><input type="checkbox" checked={payload.sponsorsCardHidden} disabled={working === "sponsors"} onChange={(event) => void toggleSponsorsCard(event.target.checked)} /><span><strong>Hide GitHub Sponsors beta card</strong><small>This controls messaging only and never changes access or stable functionality.</small></span></label>

    <div className={styles.betaActions}><button className={styles.secondaryButton} type="button" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button><button className={styles.secondaryButton} type="button" onClick={() => void copyDiagnostics()}><Copy size={15} /> Copy diagnostic information</button>{message && <span><CheckCircle2 size={14} /> {message}</span>}{actionError && <span role="alert" aria-live="assertive"><ShieldAlert size={14} /> {actionError}</span>}{loadError && payload && <span role="alert" aria-live="assertive"><ShieldAlert size={14} /> {loadError}</span>}</div>
  </div>;
}
