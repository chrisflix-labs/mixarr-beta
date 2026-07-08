"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { CheckCircle2, FlaskConical, Loader2, Save, ShieldAlert, Sparkles } from "lucide-react";
import styles from "@/app/settings/settings.module.css";

type BetaFlagDefinition = {
  key: string;
  label: string;
  description: string;
};

type BetaFeatureSettingsPayload = {
  enableExperimentalFeatures: boolean;
  flags: Record<string, boolean>;
  availableFlags: BetaFlagDefinition[];
};

const emptyPayload: BetaFeatureSettingsPayload = {
  enableExperimentalFeatures: false,
  flags: {},
  availableFlags: [],
};

function normalizePayload(payload: Partial<BetaFeatureSettingsPayload> | null | undefined): BetaFeatureSettingsPayload {
  const availableFlags = Array.isArray(payload?.availableFlags) ? payload.availableFlags : [];
  const sourceFlags = payload?.flags && typeof payload.flags === "object" ? payload.flags : {};
  return {
    enableExperimentalFeatures: payload?.enableExperimentalFeatures === true,
    availableFlags,
    flags: Object.fromEntries(
      availableFlags.map((flag) => [flag.key, sourceFlags[flag.key] === true]),
    ),
  };
}

export default function BetaFeatureSettingsForm() {
  const [payload, setPayload] = useState<BetaFeatureSettingsPayload>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadSettings() {
      try {
        const response = await axios.get("/api/settings/beta-features");
        if (!cancelled) setPayload(normalizePayload(response.data));
      } catch {
        if (!cancelled) setError("Beta feature settings are unavailable. Check database readiness and migrations.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  const setMasterEnabled = (enabled: boolean) => {
    setSaved(false);
    setPayload((current) => ({
      ...current,
      enableExperimentalFeatures: enabled,
    }));
  };

  const setFlagEnabled = (flagKey: string, enabled: boolean) => {
    setSaved(false);
    setPayload((current) => ({
      ...current,
      flags: {
        ...current.flags,
        [flagKey]: enabled,
      },
    }));
  };

  const saveSettings = async () => {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const response = await axios.put("/api/settings/beta-features", {
        enableExperimentalFeatures: payload.enableExperimentalFeatures,
        flags: payload.flags,
      });
      setPayload(normalizePayload(response.data));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (caught: any) {
      setError(caught?.response?.data?.error || "Unable to save beta feature settings.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.betaLoading}>
        <Loader2 size={16} className={styles.spinIcon} />
        Loading beta feature settings...
      </div>
    );
  }

  return (
    <div className={styles.betaSettings}>
      <div className={styles.betaIntro}>
        <div className={styles.betaIntroIcon}>
          <FlaskConical size={18} />
        </div>
        <div>
          <p>
            Experimental features are early previews of upcoming Mixarr functionality. They may change, break, disappear, or behave unexpectedly.
          </p>
          <p>
            Beta features are provided for testing and feedback. They may be incomplete, unstable, or removed in a future release.
          </p>
        </div>
      </div>

      <div className={styles.betaWarning}>
        <ShieldAlert size={17} />
        <span>Some beta features may be intended for private testing only. Please do not rely on them for production workflows unless they are marked stable.</span>
      </div>

      <div className={styles.sponsorNote}>
        <Sparkles size={17} />
        <span>Future private beta access may be offered to GitHub Sponsors as a thank-you for supporting Mixarr development.</span>
      </div>

      <label className={`${styles.toggleRow} ${styles.betaMasterToggle}`}>
        <input
          type="checkbox"
          checked={payload.enableExperimentalFeatures}
          onChange={(event) => setMasterEnabled(event.target.checked)}
        />
        <span>
          <strong>Enable experimental features</strong>
          <small>Turn this on before any individual beta feature can appear in Mixarr.</small>
        </span>
      </label>

      {payload.availableFlags.length > 0 ? (
        <div className={styles.betaFlagList} aria-label="Individual beta feature flags">
          {payload.availableFlags.map((flag) => (
            <label key={flag.key} className={styles.betaFlagRow} data-disabled={!payload.enableExperimentalFeatures}>
              <input
                type="checkbox"
                checked={payload.flags[flag.key] === true}
                disabled={!payload.enableExperimentalFeatures}
                onChange={(event) => setFlagEnabled(flag.key, event.target.checked)}
              />
              <span>
                <strong>{flag.label}</strong>
                <small>{flag.description}</small>
              </span>
              <em>Experimental</em>
            </label>
          ))}
        </div>
      ) : (
        <p className={styles.inlineNote}>No individual beta feature flags are available in this build.</p>
      )}

      <div className={styles.betaActions}>
        <button type="button" className={styles.primaryButton} onClick={saveSettings} disabled={saving}>
          {saving ? <Loader2 size={16} className={styles.spinIcon} /> : saved ? <CheckCircle2 size={16} /> : <Save size={16} />}
          {saved ? "Saved" : "Save Beta Settings"}
        </button>
        <p className={styles.inlineNote}>
          When reporting issues, please include whether experimental features are enabled.
        </p>
      </div>

      {error && <p className={styles.errorText}>{error}</p>}
      {saved && <p className={styles.successText}>Beta feature settings saved.</p>}
    </div>
  );
}
