"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, Check, Clock3, History, PauseCircle, PlayCircle, RefreshCw, RotateCcw, Shield, ShieldCheck, SlidersHorizontal } from "lucide-react";
import styles from "@/app/automation/automation.module.css";

const MODES = [
  ["DISABLED", "Disabled", "Analyze only when you ask; create no automatic proposals or Plex changes."],
  ["SUGGEST_ONLY", "Suggest Only", "Create explained suggestions for review without changing Plex."],
  ["REQUIRE_APPROVAL", "Require Approval", "Prepare changes, then wait for an authorized approval."],
  ["FULLY_AUTOMATIC", "Fully Automatic", "Apply only changes that pass every safety rule and limit."],
] as const;
const PRESETS = [
  ["CONSERVATIVE", "Conservative", "Suggestions only; Plex is never edited automatically."],
  ["BALANCED", "Balanced", "High-confidence additions with low limits; removals stay off."],
  ["AGGRESSIVE", "Aggressive", "Add, remove, and regenerate within higher guarded limits."],
] as const;

async function jsonFetch(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function human(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }
function formatDate(value?: string | null) { return value ? new Date(value).toLocaleString() : "Never"; }

export default function AutomationPoliciesWorkspace() {
  const [overview, setOverview] = useState<any>(null);
  const [policy, setPolicy] = useState<any>(null);
  const [proposals, setProposals] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [policyData, proposalData, activityData, playlistData] = await Promise.all([
      jsonFetch("/api/automation/policy"), jsonFetch("/api/automation/proposals?limit=50"), jsonFetch("/api/automation/activity?limit=50"), jsonFetch("/api/generated-playlists"),
    ]);
    setOverview(policyData); setPolicy(policyData.policy); setProposals(proposalData.proposals); setActivity(activityData.activity); setPlaylists(playlistData.playlists);
  }, []);

  useEffect(() => { load().catch((cause) => setError(cause.message)); }, [load]);
  const act = async (key: string, action: () => Promise<any>, success: string) => {
    setBusy(key); setError(null); setMessage(null);
    try { await action(); setMessage(success); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Action failed."); } finally { setBusy(null); }
  };
  const setField = (field: string, value: unknown) => setPolicy((current: any) => ({ ...current, [field]: value, preset: "CUSTOM", isCustom: true }));
  const save = () => act("save", async () => {
    if (policy.allowRemovals && !overview.policy.allowRemovals && !window.confirm("Enable automatic removals? Mixarr will still protect locked and protected tracks and create a recoverable version before every write.")) throw new Error("Automatic removals were not enabled.");
    await jsonFetch("/api/automation/policy", { method: "PUT", body: JSON.stringify(policy) });
  }, "Automation policy saved.");
  const applyPreset = (preset: string) => act(`preset:${preset}`, () => jsonFetch("/api/automation/policy", { method: "PUT", body: JSON.stringify({ preset, applyPreset: true }) }), `${human(preset)} preset applied.`);
  const pause = (paused: boolean) => act("pause", () => jsonFetch("/api/automation/pause", { method: "PUT", body: JSON.stringify({ paused, reason: paused ? "Paused from Automation Policies" : null }) }), paused ? "Automation paused." : "Automation resumed.");
  const pending = proposals.filter((proposal) => proposal.status === "PENDING" || proposal.status === "PARTIALLY_APPROVED");
  const protectedCount = playlists.filter((playlist) => playlist.automationSettings?.protected).length;
  const previewLines = useMemo(() => policy ? [
    policy.permissionLevel === "FULLY_AUTOMATIC" ? "Mixarr may edit Plex after every safety check passes." : policy.permissionLevel === "REQUIRE_APPROVAL" ? "Mixarr must wait for approval before editing Plex." : policy.permissionLevel === "SUGGEST_ONLY" ? "Mixarr will store suggestions without editing Plex." : "Mixarr automation is disabled.",
    policy.allowAdditions ? `Up to ${policy.maximumAdditionsPerUpdate} additions per update at ${policy.minimumAdditionConfidence}% confidence.` : "No automatic additions.",
    policy.allowRemovals ? `Up to ${policy.maximumRemovalsPerUpdate} removals per update at ${policy.minimumRemovalConfidence}% confidence.` : "No automatic removals.",
    `No more than ${policy.maximumChangesPerDay} changes per day or ${policy.maximumChangesPerWeek} per week.`,
    policy.quietHoursEnabled ? `Plex writes wait between ${policy.quietHoursStart} and ${policy.quietHoursEnd} (${policy.timezone}).` : "Quiet hours are off.",
    "Protected playlists and protected, locked, liked, or important tracks remain safe.",
  ] : [], [policy]);

  if (!overview || !policy) return <main className={styles.page}><div className={styles.loading}><RefreshCw className="animate-spin" /> Loading automation controls…</div>{error && <p className={styles.error}>{error}</p>}</main>;
  return <main className={styles.page}>
    <header className={styles.header}>
      <div><span className={styles.eyebrow}><ShieldCheck size={15} /> Mixarr v2.1.9</span><h1>Automation Policies</h1><p>Decide what Mixarr may analyze, suggest, approve, change, and restore.</p></div>
      <button className={overview.policy.paused ? styles.resume : styles.pause} onClick={() => pause(!overview.policy.paused)} disabled={busy !== null}>{overview.policy.paused ? <><PlayCircle size={17} /> Resume automation</> : <><PauseCircle size={17} /> Pause automation</>}</button>
    </header>
    <section className={styles.notice} role="status"><Shield size={20} /><div><strong>Automation now uses explicit safety policies.</strong><p>Your existing settings were preserved with conservative defaults. Review this policy before enabling automatic removals or scheduled regeneration.</p></div></section>
    {overview.policy.paused && <section className={styles.paused} role="alert"><PauseCircle /><div><strong>Automation is paused</strong><p>{overview.policy.pauseReason || "No automatic Plex writes can run."}</p></div></section>}
    {(message || error) && <p className={error ? styles.error : styles.success} role="status">{error || message}</p>}

    <section className={styles.metrics} aria-label="Automation health">
      <article><strong>{human(policy.preset)}</strong><span>Policy preset</span></article>
      <article><strong>{protectedCount}</strong><span>Protected playlists</span></article>
      <article><strong>{pending.length}</strong><span>Pending approvals</span></article>
      <article><strong>{overview.usage.totals.today} / {overview.usage.limits.day}</strong><span>Changes today</span></article>
      <article><strong>{overview.usage.totals.week} / {overview.usage.limits.week}</strong><span>Changes this week</span></article>
    </section>

    <section className={styles.section}><div className={styles.sectionTitle}><SlidersHorizontal /><div><h2>Automation mode</h2><p>Analysis, suggestions, approvals, and actual Plex writes are separate states.</p></div></div><div className={styles.modeGrid}>{MODES.map(([value, label, description]) => <button key={value} className={policy.permissionLevel === value ? styles.selectedCard : styles.selectCard} aria-pressed={policy.permissionLevel === value} onClick={() => setField("permissionLevel", value)}><span>{policy.permissionLevel === value && <Check size={16} />}{label}</span><small>{description}</small></button>)}</div></section>

    <section className={styles.section}><div className={styles.sectionTitle}><ShieldCheck /><div><h2>Presets</h2><p>Presets populate visible settings. Any individual change makes the policy Custom.</p></div></div><div className={styles.presetGrid}>{PRESETS.map(([value, label, description]) => <article key={value} className={policy.preset === value && !policy.isCustom ? styles.activePreset : ""}><h3>{label}</h3><p>{description}</p><button onClick={() => applyPreset(value)} disabled={busy !== null}>Use {label}</button></article>)}</div></section>

    <section className={styles.twoColumns}>
      <div className={styles.section}><h2>Change limits</h2><label><span><input type="checkbox" checked={policy.allowAdditions} onChange={(event) => setField("allowAdditions", event.target.checked)} /> Allow automatic additions</span></label><NumberField label="Maximum additions per update" value={policy.maximumAdditionsPerUpdate} onChange={(value) => setField("maximumAdditionsPerUpdate", value)} /><NumberField label="Minimum addition confidence (%)" value={policy.minimumAdditionConfidence} max={100} onChange={(value) => setField("minimumAdditionConfidence", value)} /><label><span><input type="checkbox" checked={policy.allowRemovals} onChange={(event) => setField("allowRemovals", event.target.checked)} /> Allow automatic removals</span></label><NumberField label="Maximum removals per update" value={policy.maximumRemovalsPerUpdate} onChange={(value) => setField("maximumRemovalsPerUpdate", value)} /><NumberField label="Minimum removal confidence (%)" value={policy.minimumRemovalConfidence} max={100} onChange={(value) => setField("minimumRemovalConfidence", value)} /><div className={styles.fieldRow}><NumberField label="Daily total" value={policy.maximumChangesPerDay} onChange={(value) => setField("maximumChangesPerDay", value)} /><NumberField label="Weekly total" value={policy.maximumChangesPerWeek} onChange={(value) => setField("maximumChangesPerWeek", value)} /></div></div>
      <div className={styles.section}><h2>Schedule safety</h2><label><span><input type="checkbox" checked={policy.quietHoursEnabled} onChange={(event) => setField("quietHoursEnabled", event.target.checked)} /> Delay writes during quiet hours</span></label><div className={styles.fieldRow}><TextField type="time" label="Start" value={policy.quietHoursStart} onChange={(value) => setField("quietHoursStart", value)} /><TextField type="time" label="End" value={policy.quietHoursEnd} onChange={(value) => setField("quietHoursEnd", value)} /></div><TextField label="IANA time zone" value={policy.timezone} onChange={(value) => setField("timezone", value)} /><label><span><input type="checkbox" checked={policy.allowAnalysisDuringQuietHours} onChange={(event) => setField("allowAnalysisDuringQuietHours", event.target.checked)} /> Allow analysis during quiet hours</span></label><label><span><input type="checkbox" checked={policy.allowProposalsDuringQuietHours} onChange={(event) => setField("allowProposalsDuringQuietHours", event.target.checked)} /> Allow approval proposals during quiet hours</span></label><label><span><input type="checkbox" checked={policy.requireApprovalForRegeneration} onChange={(event) => setField("requireApprovalForRegeneration", event.target.checked)} /> Require approval for scheduled regeneration</span></label></div>
    </section>

    <section className={styles.preview}><h2>Before you save</h2><ul>{previewLines.map((line) => <li key={line}>{line}</li>)}</ul><button className={styles.primary} onClick={save} disabled={busy !== null}>{busy === "save" ? "Saving…" : "Save policy"}</button></section>

    <section className={styles.section} id="protection"><div className={styles.sectionTitle}><Shield /><div><h2>Playlist protection</h2><p>Protection overrides every automatic policy. Manual edits still work after confirmation.</p></div></div><div className={styles.list}>{playlists.length ? playlists.map((playlist) => { const protectedValue = Boolean(playlist.automationSettings?.protected); return <article className={styles.row} key={playlist.id}><div><strong>{playlist.plexPlaylistTitle}</strong><small>{playlist._count?.tracks || playlist.trackCount} tracks · {playlist.automationSettings?.useGlobalPolicy === false ? "Custom policy" : "Global policy"}</small></div><span className={protectedValue ? styles.badgeProtected : styles.badgeDefault}>{protectedValue ? "Protected" : "Automation eligible"}</span><button disabled={busy !== null} onClick={() => act(`protect:${playlist.id}`, () => jsonFetch(`/api/automation/playlists/${playlist.id}/protection`, { method: "PUT", body: JSON.stringify({ protected: !protectedValue, reason: !protectedValue ? "Protected from Automation Policies" : null }) }), protectedValue ? "Playlist protection removed." : "Playlist protected.")}>{protectedValue ? "Unprotect" : "Protect"}</button><button disabled={playlist.automationSettings?.useGlobalPolicy !== false || busy !== null} onClick={() => act(`reset:${playlist.id}`, () => jsonFetch(`/api/automation/playlists/${playlist.id}/policy`, { method: "DELETE" }), "Playlist reset to the global policy.")}>Reset to global</button></article>; }) : <p>No managed playlists yet.</p>}</div></section>

    <section className={styles.section} id="approvals"><div className={styles.sectionTitle}><Clock3 /><div><h2>Approval queue</h2><p>Approval rechecks playlist state, current policy, protection, limits, and version safety.</p></div></div><div className={styles.list}>{pending.length ? pending.map((proposal) => { const chosen = proposal.items.filter((item: any) => selectedItems[item.id]); return <article className={styles.proposal} key={proposal.id}><div><strong>{proposal.generatedPlaylist.plexPlaylistTitle}</strong><small>{human(proposal.source)} · {formatDate(proposal.createdAt)}</small><p>{proposal.items.filter((item: any) => item.action === "ADD").length} additions · {proposal.items.filter((item: any) => item.action === "REMOVE").length} removals</p><div className={styles.proposalItems}>{proposal.items.map((item: any) => <label key={item.id}><input type="checkbox" checked={Boolean(selectedItems[item.id])} onChange={(event) => setSelectedItems((current) => ({ ...current, [item.id]: event.target.checked }))} /><span>{human(item.action)} · {item.confidence == null ? "Confidence unavailable" : `${item.confidence}% confidence`}</span></label>)}</div></div><div><button disabled={busy !== null} onClick={() => act(`approve:${proposal.id}`, () => jsonFetch(`/api/automation/proposals/${proposal.id}/approve`, { method: "POST", body: "{}" }), "Proposal approved and applied.")}>Approve all</button><button disabled={busy !== null || !chosen.length} onClick={() => act(`approve-selected:${proposal.id}`, () => jsonFetch(`/api/automation/proposals/${proposal.id}/approve`, { method: "POST", body: JSON.stringify({ itemIds: chosen.map((item: any) => item.id) }) }), "Selected changes approved and applied.")}>Approve selected</button><button disabled={busy !== null || !chosen.length} onClick={() => act(`reject-selected:${proposal.id}`, () => jsonFetch(`/api/automation/proposals/${proposal.id}/reject`, { method: "POST", body: JSON.stringify({ itemIds: chosen.map((item: any) => item.id), reason: "Selected changes rejected" }) }), "Selected changes rejected.")}>Reject selected</button><button disabled={busy !== null} onClick={() => act(`reject:${proposal.id}`, () => jsonFetch(`/api/automation/proposals/${proposal.id}/reject`, { method: "POST", body: JSON.stringify({ reason: "Rejected from Automation Policies" }) }), "Proposal rejected.")}>Reject all</button><button disabled={busy !== null} onClick={() => act(`recalculate:${proposal.id}`, () => jsonFetch(`/api/automation/proposals/${proposal.id}/recalculate`, { method: "POST", body: "{}" }), "Proposal recalculated.")}>Recalculate</button></div></article>; }) : <p className={styles.empty}>No automation proposals are waiting for approval.</p>}</div></section>

    <section className={styles.section} id="activity"><div className={styles.sectionTitle}><Activity /><div><h2>Automation activity</h2><p>What Mixarr intended, what policy allowed, and what actually happened.</p></div></div><div className={styles.list}>{activity.length ? activity.map((item) => <article className={styles.activity} key={item.id}><div className={styles.activityIcon}>{item.status === "APPLIED" ? <Check /> : item.status === "BLOCKED" || item.status === "FAILED" ? <AlertTriangle /> : <History />}</div><div><strong>{item.generatedPlaylist.plexPlaylistTitle}</strong><small>{human(item.source)} · {human(item.status)} · {formatDate(item.createdAt)}</small><p>{item.summary}</p><small>Proposed: {item.proposedAdditions} additions, {item.proposedRemovals} removals · Applied: {item.appliedAdditions} additions, {item.appliedRemovals} removals · Reason: {human(item.reasonCode)}</small></div>{item.playlistRevisionId && !item.rollbackStatus && <button disabled={busy !== null} onClick={async () => { setBusy(`rollback:${item.id}`); setError(null); try { const preview = await jsonFetch(`/api/automation/activity/${item.id}/rollback`, { method: "POST", body: JSON.stringify({ confirm: false }) }); if (window.confirm(`${preview.warning || "Restore the playlist to its pre-automation version?"}\n\nThis creates another safety version first.`)) await jsonFetch(`/api/automation/activity/${item.id}/rollback`, { method: "POST", body: JSON.stringify({ confirm: true, expectedPlaylistUpdatedAt: preview.preview.current.updatedAt }) }); setMessage("Automation update rolled back."); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Rollback failed."); } finally { setBusy(null); } }}><RotateCcw size={15} /> Roll back</button>}{item.rollbackStatus && <span className={styles.badgeProtected}>{human(item.rollbackStatus)}</span>}</article>) : <p className={styles.empty}>No automation activity has been recorded yet.</p>}</div><Link className={styles.inlineLink} href="/job-history">View related Job History</Link></section>
  </main>;
}

function NumberField({ label, value, onChange, max = 100000 }: { label: string; value: number; onChange: (value: number) => void; max?: number }) { return <label className={styles.field}><span>{label}</span><input type="number" min="0" max={max} value={value} onChange={(event) => onChange(Math.max(0, Math.min(max, Number(event.target.value))))} /></label>; }
function TextField({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) { return <label className={styles.field}><span>{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
