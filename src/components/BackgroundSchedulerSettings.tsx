"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock, RotateCcw, Save } from "lucide-react";
import {
  buildSchedulerSettingsFromInput,
  DAY_NAMES,
  DEFAULT_SCHEDULER_SETTINGS,
  generateSchedulerCron,
  schedulerSummary,
  type ResolvedSchedulerSettings,
  type SchedulerMode,
} from "@/lib/schedulerSettingsCore";
import styles from "@/app/settings/settings.module.css";

type SchedulerApiPayload = {
  settings: ResolvedSchedulerSettings;
  status: {
    schedulerEnabled: boolean;
    currentSchedule: string;
    currentCron: string;
    lastRun: null | {
      startedAt: string;
      finishedAt: string | null;
      status: string;
      summary: string | null;
    };
    nextRun: string | null;
  };
  message?: string;
};

function formatDate(value: string | null | undefined) {
  if (!value) return "Not available";
  return new Date(value).toLocaleString();
}

function formFromSettings(settings: ResolvedSchedulerSettings) {
  return {
    schedulerEnabled: settings.schedulerEnabled,
    schedulerMode: settings.schedulerMode,
    schedulerCron: settings.schedulerCron,
    schedulerTime: settings.schedulerTime,
    schedulerDayOfWeek: String(settings.schedulerDayOfWeek),
    schedulerIntervalHours: String(settings.schedulerIntervalHours),
  };
}

export default function BackgroundSchedulerSettings() {
  const [form, setForm] = useState(() => formFromSettings({ ...DEFAULT_SCHEDULER_SETTINGS, source: "default" }));
  const [payload, setPayload] = useState<SchedulerApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void fetchSettings();
  }, []);

  async function fetchSettings() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/settings/scheduler", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load scheduler settings.");
      setPayload(data);
      setForm(formFromSettings(data.settings));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load scheduler settings.");
    } finally {
      setLoading(false);
    }
  }

  const preview = useMemo(() => {
    try {
      const settings = buildSchedulerSettingsFromInput({
        ...form,
        schedulerDayOfWeek: Number(form.schedulerDayOfWeek),
        schedulerIntervalHours: Number(form.schedulerIntervalHours),
      });
      return {
        cron: generateSchedulerCron(settings),
        summary: schedulerSummary(settings),
      };
    } catch {
      return {
        cron: form.schedulerCron,
        summary: `Runs using custom cron: ${form.schedulerCron}.`,
      };
    }
  }, [form]);

  function updateField(field: keyof typeof form, value: string | boolean) {
    setMessage("");
    setError("");
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function saveSettings(nextForm = form) {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/settings/scheduler", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...nextForm,
          schedulerDayOfWeek: Number(nextForm.schedulerDayOfWeek),
          schedulerIntervalHours: Number(nextForm.schedulerIntervalHours),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save scheduler settings.");
      setPayload(data);
      setForm(formFromSettings(data.settings));
      setMessage(data.message || "Scheduler settings saved. New schedule is active.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save scheduler settings.");
    } finally {
      setSaving(false);
    }
  }

  function resetToDefault() {
    const defaults = formFromSettings({ ...DEFAULT_SCHEDULER_SETTINGS, source: "default" });
    setForm(defaults);
    void saveSettings(defaults);
  }

  const status = payload?.status;

  return (
    <div className={styles.schedulerForm}>
      <div className={styles.schedulerStatusGrid}>
        <div className={styles.schedulerStatusCard}>
          <span>Status</span>
          <strong>{form.schedulerEnabled ? "Scheduler is enabled." : "Scheduler is disabled."}</strong>
          <small>Current schedule: {status?.currentSchedule || preview.summary}</small>
        </div>
        <div className={styles.schedulerStatusCard}>
          <span>Cron</span>
          <strong>{status?.currentCron || preview.cron}</strong>
          <small>Source: {payload?.settings.source === "environment" ? "SYNC_CRON_SCHEDULE fallback" : payload?.settings.source || "default"}</small>
        </div>
      </div>

      <label className={styles.toggleRow}>
        <input
          type="checkbox"
          checked={form.schedulerEnabled}
          onChange={(event) => updateField("schedulerEnabled", event.target.checked)}
        />
        <span>
          <strong>Enable background scheduler</strong>
          <small>When disabled, manual sync buttons and retry tools still work.</small>
        </span>
      </label>

      <div className={styles.schedulerGrid}>
        <div className={styles.field}>
          <label htmlFor="scheduler-mode">Schedule type</label>
          <select
            id="scheduler-mode"
            value={form.schedulerMode}
            onChange={(event) => updateField("schedulerMode", event.target.value as SchedulerMode)}
            className={styles.input}
          >
            <option value="daily">Daily</option>
            <option value="interval">Every X hours</option>
            <option value="weekly">Weekly</option>
            <option value="custom">Custom cron</option>
          </select>
        </div>

        {(form.schedulerMode === "daily" || form.schedulerMode === "weekly") && (
          <div className={styles.field}>
            <label htmlFor="scheduler-time">Run time</label>
            <input
              id="scheduler-time"
              type="time"
              value={form.schedulerTime}
              onChange={(event) => updateField("schedulerTime", event.target.value)}
              className={styles.input}
            />
          </div>
        )}

        {form.schedulerMode === "weekly" && (
          <div className={styles.field}>
            <label htmlFor="scheduler-day">Day of week</label>
            <select
              id="scheduler-day"
              value={form.schedulerDayOfWeek}
              onChange={(event) => updateField("schedulerDayOfWeek", event.target.value)}
              className={styles.input}
            >
              {DAY_NAMES.map((day, index) => (
                <option key={day} value={index}>{day}</option>
              ))}
            </select>
          </div>
        )}

        {form.schedulerMode === "interval" && (
          <div className={styles.field}>
            <label htmlFor="scheduler-interval">Every X hours</label>
            <input
              id="scheduler-interval"
              type="number"
              min="1"
              max="24"
              step="1"
              value={form.schedulerIntervalHours}
              onChange={(event) => updateField("schedulerIntervalHours", event.target.value)}
              className={styles.input}
            />
          </div>
        )}

        {form.schedulerMode === "custom" && (
          <div className={`${styles.field} ${styles.fullWidthField}`}>
            <label htmlFor="scheduler-cron">Custom cron</label>
            <input
              id="scheduler-cron"
              type="text"
              value={form.schedulerCron}
              onChange={(event) => updateField("schedulerCron", event.target.value)}
              className={styles.input}
              placeholder="0 3 * * *"
            />
          </div>
        )}
      </div>

      <div className={styles.schedulerPreview}>
        <Clock size={16} />
        <div>
          <strong>Cron schedule: {preview.cron}</strong>
          <span>{preview.summary}</span>
        </div>
      </div>

      {(status?.lastRun || status?.nextRun) && (
        <dl className={styles.schedulerRunRows}>
          {status.lastRun && (
            <div>
              <dt>Last run</dt>
              <dd>{formatDate(status.lastRun.startedAt)} ({status.lastRun.status})</dd>
            </div>
          )}
          {status.nextRun && (
            <div>
              <dt>Next run</dt>
              <dd>{formatDate(status.nextRun)}</dd>
            </div>
          )}
        </dl>
      )}

      {loading && <p className={styles.inlineNote}>Loading scheduler settings...</p>}
      {message && <p className={styles.successText}>{message}</p>}
      {error && <p className={styles.errorText}>{error}</p>}

      <div className={styles.schedulerActions}>
        <button type="button" onClick={() => void saveSettings()} disabled={saving || loading} className={styles.primaryButton}>
          <Save size={16} />
          {saving ? "Saving..." : "Save Scheduler Settings"}
        </button>
        <button type="button" onClick={resetToDefault} disabled={saving || loading} className={styles.secondaryButton}>
          <RotateCcw size={16} />
          Reset to Default
        </button>
      </div>
    </div>
  );
}
