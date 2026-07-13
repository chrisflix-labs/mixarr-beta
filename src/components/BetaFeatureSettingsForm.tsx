"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import axios from "axios";
import { CheckCircle2, Copy, Download, ExternalLink, FlaskConical, LifeBuoy, Loader2, RotateCcw, Save, ShieldAlert, Sparkles } from "lucide-react";
import styles from "@/app/settings/settings.module.css";

type FeatureState = { key: string; enabled: boolean; available: boolean; reason: string; userSelectable: boolean; explanation: string; definition: { name: string; description: string; category: string; minimumAccessLevel: string; adminOnly: boolean; riskLevel: string; warningText: string; feedbackCategory: string; stableFallback: string } };
type Payload = { applicationVersion?: string; enabled: boolean; accessLevel: string; serverAccessLevel: string; isAdmin: boolean; warningAcceptedAt: string | null; features: FeatureState[]; sponsors?: { url: string; text: string } | null; support?: { feedbackUrl?: string | null; githubIssuesUrl?: string | null; discordSupportUrl?: string | null } };

export default function BetaFeatureSettingsForm() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [draftFlags, setDraftFlags] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [diagnosticReport, setDiagnosticReport] = useState<Record<string, unknown> | null>(null);

  const applyPayload = (next: Payload) => {
    setPayload(next);
    setDraftFlags(Object.fromEntries(next.features.map((feature) => [feature.key, feature.enabled])));
  };

  useEffect(() => {
    axios.get("/api/beta/status").then((response) => applyPayload(response.data)).catch(() => setError("Beta feature settings are unavailable. Check database readiness and migrations."));
  }, []);

  const save = async (enabled = payload?.enabled === true, acknowledgedNow = false) => {
    if (!payload) return;
    setSaving(true); setSaved(false); setError("");
    try {
      const response = await axios.put("/api/beta/preferences", { enableBetaFeatures: enabled, flags: draftFlags, acknowledged: acknowledgedNow });
      const refreshed = await axios.get("/api/beta/status");
      applyPayload({ ...refreshed.data, ...response.data });
      setSaved(true); setShowConfirmation(false); setAcknowledged(false);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (caught: any) { setError(caught?.response?.data?.error || "Unable to save beta feature settings."); }
    finally { setSaving(false); }
  };
  const previewDiagnostics = async () => {
    const response = await axios.post("/api/beta/feedback-report", { action: "Beta settings diagnostics" });
    setDiagnosticReport(response.data.report);
  };
  const reportText = diagnosticReport ? JSON.stringify(diagnosticReport, null, 2) : "";
  const downloadDiagnostics = () => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([reportText], { type: "application/json" }));
    link.download = `mixarr-beta-feedback-${Date.now()}.json`; link.click(); URL.revokeObjectURL(link.href);
  };

  if (!payload && !error) return <div className={styles.betaLoading}><Loader2 size={16} className={styles.spinIcon} /> Loading beta feature settings...</div>;
  if (!payload) return <p className={styles.errorText}>{error}</p>;
  const feedbackUrl = payload.support?.feedbackUrl || payload.support?.githubIssuesUrl || "/support";
  const contextualFeedbackUrl = (featureKey: string) => {
    if (!feedbackUrl.startsWith("http")) return feedbackUrl;
    try { const url = new URL(feedbackUrl); url.searchParams.set("mixarrVersion", payload.applicationVersion || "unknown"); url.searchParams.set("feature", featureKey); url.searchParams.set("page", "/settings"); return url.toString(); } catch { return feedbackUrl; }
  };

  return (
    <div className={styles.betaSettings}>
      <div className={styles.betaIntro}>
        <div className={styles.betaIntroIcon}><FlaskConical size={18} /></div>
        <div><p><strong>Smart Mix Beta Lab</strong></p><p>Access: {payload.accessLevel.replaceAll("_", " ")} · Server maximum: {payload.serverAccessLevel.replaceAll("_", " ")}</p><p>{payload.enabled ? "Beta features are enabled; every experiment remains individually gated." : "Beta features are disabled. Mixarr will continue using stable playlist generation behavior."}</p></div>
      </div>

      {payload.enabled && <div className={styles.betaWarning}><ShieldAlert size={17} /><span>Beta results may differ from stable Smart Mix behavior. Playlist metadata records the model and enabled flags, and supported automatic changes save a version first.{payload.support?.discordSupportUrl && <> <a href={payload.support.discordSupportUrl} target="_blank" rel="noopener noreferrer">Ask in Discord</a></>}</span></div>}

      {payload.sponsors && <div className={styles.sponsorNote}><Sparkles size={17} /><span><strong>Support Mixarr Development</strong><br />{payload.sponsors.text} <a href={payload.sponsors.url} target="_blank" rel="noopener noreferrer">GitHub Sponsors <ExternalLink size={12} /></a></span></div>}

      <label className={`${styles.toggleRow} ${styles.betaMasterToggle}`}>
        <input type="checkbox" checked={payload.enabled} onChange={(event) => event.target.checked ? setShowConfirmation(true) : void save(false)} />
        <span><strong>Enable Beta Features</strong><small>Disabled by default. Enabling the program does not enable individual experiments.</small></span>
      </label>

      {payload.enabled && <div className={styles.betaFlagList} aria-label="Individual beta feature flags">
        {payload.features.filter((feature) => feature.available || feature.reason === "emergency_disabled").map((feature) => (
          <label key={feature.key} className={styles.betaFlagRow} data-disabled={!feature.userSelectable || feature.reason === "emergency_disabled"} title={`${feature.definition.warningText} Stable fallback: ${feature.definition.stableFallback}`}>
            <input type="checkbox" checked={draftFlags[feature.key] === true} disabled={!feature.userSelectable || feature.reason === "emergency_disabled"} onChange={(event) => { setSaved(false); setDraftFlags((current) => ({ ...current, [feature.key]: event.target.checked })); }} />
            <span><strong>{feature.definition.name}</strong><small>{feature.definition.description}</small><small>Risk: {feature.definition.riskLevel} · {feature.definition.minimumAccessLevel.replaceAll("_", " ")}{feature.definition.adminOnly ? " · ADMIN ONLY" : ""}</small><small>Fallback: {feature.definition.stableFallback}</small><small><a href={contextualFeedbackUrl(feature.key)} target={feedbackUrl.startsWith("http") ? "_blank" : undefined} rel={feedbackUrl.startsWith("http") ? "noopener noreferrer" : undefined} onClick={(event) => event.stopPropagation()}>Send feedback</a></small>{feature.reason === "emergency_disabled" && <small>{feature.explanation}</small>}</span>
            <em>{feature.definition.minimumAccessLevel === "PRIVATE_BETA" ? "PRIVATE BETA" : feature.definition.minimumAccessLevel === "DEVELOPER" ? "UNSTABLE" : "BETA"}</em>
          </label>
        ))}
      </div>}

      <div className={styles.betaActions}>
        {payload.enabled && <button type="button" className={styles.primaryButton} onClick={() => void save()} disabled={saving}>{saving ? <Loader2 size={16} className={styles.spinIcon} /> : saved ? <CheckCircle2 size={16} /> : <Save size={16} />}{saved ? "Saved" : "Save Beta Settings"}</button>}
        {payload.enabled && <button type="button" className={styles.secondaryButton} onClick={() => { setDraftFlags(Object.fromEntries(payload.features.map((feature) => [feature.key, false]))); }}><RotateCcw size={15} /> Reset to stable behavior</button>}
        <a className={styles.secondaryButton} href={feedbackUrl} target={feedbackUrl.startsWith("http") ? "_blank" : undefined} rel={feedbackUrl.startsWith("http") ? "noopener noreferrer" : undefined}><LifeBuoy size={15} /> Send Beta Feedback</a>
        <button type="button" className={styles.secondaryButton} onClick={() => void previewDiagnostics()}><ShieldAlert size={15} /> Preview Diagnostic Report</button>
        {payload.isAdmin && <Link className={styles.secondaryButton} href="/settings/beta">Beta Administration</Link>}
      </div>
      {diagnosticReport && <details open><summary>Sanitized diagnostic preview</summary><pre className={styles.betaReportPreview}>{reportText}</pre><div className={styles.betaActions}><button type="button" className={styles.secondaryButton} onClick={() => void navigator.clipboard.writeText(reportText)}><Copy size={15} /> Copy Report</button><button type="button" className={styles.secondaryButton} onClick={downloadDiagnostics}><Download size={15} /> Download Report</button>{payload.support?.discordSupportUrl && <a className={styles.secondaryButton} href={payload.support.discordSupportUrl} target="_blank" rel="noopener noreferrer">Open Discord Support</a>}</div></details>}
      {error && <p className={styles.errorText}>{error}</p>}

      {showConfirmation && <div className={styles.betaModalBackdrop} role="presentation" onMouseDown={() => setShowConfirmation(false)}>
        <div className={styles.betaModal} role="dialog" aria-modal="true" aria-labelledby="enable-beta-title" onMouseDown={(event) => event.stopPropagation()}>
          <h3 id="enable-beta-title">Enable Smart Mix Beta Features?</h3>
          <p>Beta features may change between releases and can produce different playlist results than the stable Smart Mix engine.</p>
          <p>Experimental features remain individually disabled until you enable them. Mixarr records beta usage and saves playlist versions before supported automatic changes.</p>
          <label className={styles.toggleRow}><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span><strong>I understand that beta playlist results may change.</strong></span></label>
          <div className={styles.betaActions}><button type="button" className={styles.secondaryButton} onClick={() => setShowConfirmation(false)}>Cancel</button><button type="button" className={styles.primaryButton} disabled={!acknowledged || saving} onClick={() => void save(true, true)}>Enable Beta Program</button></div>
        </div>
      </div>}
    </div>
  );
}
