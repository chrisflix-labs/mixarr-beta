"use client";

import { useEffect, useState } from "react";
import styles from "./TroubleshootingSettings.module.css";

type Settings = {
  enabled: boolean;
  aiAssistedEnabled: boolean;
  permitSanitizedLogs: boolean;
  permitTrackMetadata: boolean;
  allowExport: boolean;
  whatIfSimulationsEnabled: boolean;
  requireAdminApprovalForChanges: boolean;
  advancedDetailsByDefault: boolean;
  retentionDays: number;
  maximumLogWindowMinutes: number;
  maximumBundleBytes: number;
  maximumAiRequestsPerDay: number;
};

const booleanFields: Array<{ key: keyof Settings; label: string; detail: string }> = [
  { key: "enabled", label: "Enable troubleshooting", detail: "Allows deterministic, privacy-scoped diagnostic sessions." },
  { key: "aiAssistedEnabled", label: "Allow governed AI explanations", detail: "Opt-in. Only sanitized approved context can reach the configured AI provider." },
  { key: "permitSanitizedLogs", label: "Permit sanitized logs", detail: "Makes the sanitized-logs category available for explicit selection." },
  { key: "permitTrackMetadata", label: "Permit track metadata", detail: "Makes track-level metadata available for explicit selection." },
  { key: "allowExport", label: "Allow diagnostic exports", detail: "Permits users to download the sanitized JSON bundle." },
  { key: "whatIfSimulationsEnabled", label: "Allow what-if simulations", detail: "Runs read-only recipe previews without regeneration or external side effects." },
  { key: "requireAdminApprovalForChanges", label: "Require admin approval for changes", detail: "Adds an administrator gate before an accepted suggestion can be applied." },
  { key: "advancedDetailsByDefault", label: "Show advanced details by default", detail: "Expands technical evidence for new sessions." },
];

const numberFields: Array<{ key: keyof Settings; label: string; min: number; max: number; suffix: string }> = [
  { key: "retentionDays", label: "Session retention", min: 1, max: 365, suffix: "days" },
  { key: "maximumLogWindowMinutes", label: "Maximum log window", min: 5, max: 10080, suffix: "minutes" },
  { key: "maximumBundleBytes", label: "Maximum sanitized bundle", min: 64000, max: 5000000, suffix: "bytes" },
  { key: "maximumAiRequestsPerDay", label: "Daily AI request limit", min: 0, max: 100, suffix: "requests" },
];

function editableSettings(value: Settings): Settings {
  return {
    enabled: value.enabled,
    aiAssistedEnabled: value.aiAssistedEnabled,
    permitSanitizedLogs: value.permitSanitizedLogs,
    permitTrackMetadata: value.permitTrackMetadata,
    allowExport: value.allowExport,
    whatIfSimulationsEnabled: value.whatIfSimulationsEnabled,
    requireAdminApprovalForChanges: value.requireAdminApprovalForChanges,
    advancedDetailsByDefault: value.advancedDetailsByDefault,
    retentionDays: value.retentionDays,
    maximumLogWindowMinutes: value.maximumLogWindowMinutes,
    maximumBundleBytes: value.maximumBundleBytes,
    maximumAiRequestsPerDay: value.maximumAiRequestsPerDay,
  };
}

export default function TroubleshootingSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [status, setStatus] = useState("Loading troubleshooting policy…");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/troubleshooting/settings")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message || "Troubleshooting policy is unavailable.");
        return payload.settings as Settings;
      })
      .then((value) => { if (active) { const editable = editableSettings(value); setSettings(editable); setDraft(editable); setStatus(""); } })
      .catch((error) => { if (active) setStatus(error instanceof Error ? error.message : "Troubleshooting policy is unavailable."); });
    return () => { active = false; };
  }, []);

  async function save() {
    if (!draft) return;
    setSaving(true); setStatus("Saving…");
    try {
      const response = await fetch("/api/troubleshooting/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "The policy could not be saved.");
      const editable = editableSettings(payload.settings); setSettings(editable); setDraft(editable); setStatus("Troubleshooting policy saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The policy could not be saved.");
    } finally { setSaving(false); }
  }

  if (!draft) return <p role="status" className={styles.status}>{status}</p>;
  const dirty = JSON.stringify(settings) !== JSON.stringify(draft);

  return (
    <div className={styles.wrapper}>
      <div className={styles.flags}>
        {booleanFields.map((field) => (
          <label key={field.key} className={styles.flag}>
            <input type="checkbox" checked={Boolean(draft[field.key])} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.checked })} />
            <span><strong>{field.label}</strong><small>{field.detail}</small></span>
          </label>
        ))}
      </div>
      <div className={styles.limits}>
        {numberFields.map((field) => (
          <label key={field.key}>
            <span>{field.label}</span>
            <span className={styles.inputRow}>
              <input type="number" min={field.min} max={field.max} value={Number(draft[field.key])} onChange={(event) => setDraft({ ...draft, [field.key]: Number(event.target.value) })} />
              <small>{field.suffix}</small>
            </span>
          </label>
        ))}
      </div>
      <div className={styles.actions}>
        <button type="button" disabled={!dirty || saving} onClick={save}>{saving ? "Saving…" : "Save troubleshooting policy"}</button>
        <span role="status" aria-live="polite">{status}</span>
      </div>
      <p className={styles.notice}>AI remains disabled by default and also requires an enabled provider and feature in AI Governance. Expanding shared diagnostic categories requires administrator permission.</p>
    </div>
  );
}
