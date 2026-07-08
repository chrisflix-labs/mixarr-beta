"use client";

import { useMemo, useState } from "react";
import { Activity, AudioWaveform, CheckCircle2, Disc3, KeyRound, Loader2, Music2, RadioTower, Save, Tags, Trash2, XCircle } from "lucide-react";
import styles from "@/app/settings/settings.module.css";

type UseKey = "popularity" | "tags" | "bpm" | "audioFeatures";

type Provider = {
  providerKey: string;
  name: string;
  shortName: string;
  icon: string;
  description: string;
  supportedUses: UseKey[];
  credentialFields: Array<{ key: string; label: string; secret: boolean; required: boolean }>;
  credentialSource: "ui" | "env" | "none";
  hasCredentials: boolean;
  maskedCredential: string | null;
  enabled: boolean;
  uses: Record<UseKey, boolean>;
  status: string;
  lastTestStatus: string | null;
  lastTestMessage: string | null;
  lastTestAt: string | null;
};

type Payload = {
  encryption: { configured: boolean; warning: string | null };
  providers: Provider[];
  summary: Record<UseKey, string[]> & { allDisabled: boolean };
  providerOrder: Record<UseKey, string[]>;
};

const useLabels: Record<UseKey, string> = {
  popularity: "Popularity",
  tags: "Tags / Genres",
  bpm: "BPM",
  audioFeatures: "Audio Features",
};

function ProviderIcon({ icon }: { icon: string }) {
  const props = { size: 20, "aria-hidden": true };
  if (icon === "spotify") return <Music2 {...props} />;
  if (icon === "deezer") return <AudioWaveform {...props} />;
  if (icon === "discogs") return <Disc3 {...props} />;
  if (icon === "musicbrainz") return <RadioTower {...props} />;
  if (icon === "audiodb") return <Activity {...props} />;
  if (icon === "lastfm") return <Tags {...props} />;
  return <KeyRound {...props} />;
}

function statusTone(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes("failed") || normalized.includes("missing")) return "warning";
  if (normalized.includes("disabled")) return "muted";
  return "ok";
}

function formatLastTest(provider: Provider) {
  if (!provider.lastTestAt && !provider.lastTestMessage) return "Not tested yet";
  const testedAt = provider.lastTestAt ? new Date(provider.lastTestAt) : null;
  const time = testedAt && Number.isFinite(testedAt.getTime()) ? testedAt.toLocaleString() : "recently";
  return `${provider.lastTestMessage || provider.lastTestStatus || "Test recorded"} · ${time}`;
}

export default function ExternalApiSettingsPanel({ initialPayload }: { initialPayload: Payload }) {
  const [payload, setPayload] = useState(initialPayload);
  const [drafts, setDrafts] = useState<Record<string, Provider>>(() =>
    Object.fromEntries(initialPayload.providers.map((provider) => [provider.providerKey, provider])),
  );
  const [credentials, setCredentials] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<Record<string, { type: "ok" | "error"; text: string }>>({});

  const providers = useMemo(() => payload.providers.map((provider) => drafts[provider.providerKey] || provider), [payload.providers, drafts]);

  function setProvider(providerKey: string, update: Partial<Provider>) {
    setDrafts((current) => ({
      ...current,
      [providerKey]: { ...current[providerKey], ...update },
    }));
  }

  function setUse(provider: Provider, use: UseKey, checked: boolean) {
    setProvider(provider.providerKey, { uses: { ...provider.uses, [use]: checked } });
  }

  async function refreshFromResponse(response: Response) {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || data.message || "Request failed");
    setPayload(data);
    setDrafts(Object.fromEntries(data.providers.map((provider: Provider) => [provider.providerKey, provider])));
    return data;
  }

  async function save(provider: Provider) {
    setBusy((current) => ({ ...current, [provider.providerKey]: "save" }));
    setMessage((current) => ({ ...current, [provider.providerKey]: { type: "ok", text: "" } }));
    try {
      await refreshFromResponse(await fetch(`/api/settings/external-apis/${provider.providerKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: provider.enabled,
          uses: provider.uses,
          credentials: credentials[provider.providerKey] || {},
        }),
      }));
      setCredentials((current) => ({ ...current, [provider.providerKey]: {} }));
      setMessage((current) => ({ ...current, [provider.providerKey]: { type: "ok", text: "Saved." } }));
    } catch (error: any) {
      setMessage((current) => ({ ...current, [provider.providerKey]: { type: "error", text: error.message || "Save failed." } }));
    } finally {
      setBusy((current) => ({ ...current, [provider.providerKey]: "" }));
    }
  }

  async function test(provider: Provider) {
    setBusy((current) => ({ ...current, [provider.providerKey]: "test" }));
    try {
      const data = await refreshFromResponse(await fetch(`/api/settings/external-apis/${provider.providerKey}/test`, { method: "POST" }));
      setMessage((current) => ({
        ...current,
        [provider.providerKey]: { type: data.success ? "ok" : "error", text: data.message || "Test completed." },
      }));
    } catch (error: any) {
      setMessage((current) => ({ ...current, [provider.providerKey]: { type: "error", text: error.message || "Test failed." } }));
    } finally {
      setBusy((current) => ({ ...current, [provider.providerKey]: "" }));
    }
  }

  async function removeCredentials(provider: Provider) {
    setBusy((current) => ({ ...current, [provider.providerKey]: "remove" }));
    try {
      await refreshFromResponse(await fetch(`/api/settings/external-apis/${provider.providerKey}/credentials`, { method: "DELETE" }));
      setCredentials((current) => ({ ...current, [provider.providerKey]: {} }));
      setMessage((current) => ({ ...current, [provider.providerKey]: { type: "ok", text: "Saved credential removed." } }));
    } catch (error: any) {
      setMessage((current) => ({ ...current, [provider.providerKey]: { type: "error", text: error.message || "Remove failed." } }));
    } finally {
      setBusy((current) => ({ ...current, [provider.providerKey]: "" }));
    }
  }

  function summaryText(use: UseKey) {
    const names = payload.summary[use];
    return names.length ? names.join(", ") : use === "popularity" || use === "tags" ? "Disabled" : "Local only";
  }

  return (
    <div className={styles.externalApiPanel}>
      <div className={styles.externalApiIntro}>
        <div>
          <h4>External APIs</h4>
          <p>Configure optional API providers used for popularity, tags, BPM, and audio features. Local analysis can run without API providers.</p>
        </div>
        <div className={styles.summaryChips}>
          {(Object.keys(useLabels) as UseKey[]).map((use) => (
            <span key={use}>{useLabels[use]}: {summaryText(use)}</span>
          ))}
        </div>
      </div>

      {payload.summary.allDisabled && (
        <p className={styles.externalApiNotice}>
          APIs disabled. Mixarr will use local analysis and existing Plex/imported metadata where available.
        </p>
      )}
      {payload.encryption.warning && (
        <p className={styles.externalApiWarning}>{payload.encryption.warning}</p>
      )}

      <div className={styles.providerOrderGrid}>
        {(Object.keys(useLabels) as UseKey[]).map((use) => (
          <div key={use}>
            <strong>{useLabels[use]} provider order</strong>
            <span>{payload.providerOrder[use]?.length ? payload.providerOrder[use].join(" → ") : use === "bpm" || use === "audioFeatures" ? "Local only" : "No providers enabled"}</span>
          </div>
        ))}
      </div>

      <div className={styles.externalApiGrid}>
        {providers.map((provider) => {
          const currentBusy = busy[provider.providerKey];
          const providerMessage = message[provider.providerKey];
          return (
            <article key={provider.providerKey} className={styles.externalApiCard}>
              <div className={styles.externalApiCardHeader}>
                <span className={styles.providerIcon}>
                  <ProviderIcon icon={provider.icon} />
                </span>
                <div>
                  <h4>{provider.name}</h4>
                  <p>{provider.description}</p>
                </div>
                <span className={styles.statusPill} data-tone={statusTone(provider.status)}>{provider.status}</span>
              </div>

              <label className={styles.switchRow}>
                <input
                  type="checkbox"
                  checked={provider.enabled}
                  onChange={(event) => setProvider(provider.providerKey, { enabled: event.target.checked })}
                />
                <span>Enable provider</span>
              </label>

              <div className={styles.useToggleGrid}>
                {provider.supportedUses.map((use) => (
                  <label key={use} className={styles.switchRow}>
                    <input
                      type="checkbox"
                      checked={provider.uses[use]}
                      onChange={(event) => setUse(provider, use, event.target.checked)}
                    />
                    <span>Use for {useLabels[use]}</span>
                  </label>
                ))}
              </div>

              {provider.credentialFields.length > 0 ? (
                <div className={styles.credentialGrid}>
                  <div className={styles.credentialStatus}>
                    <KeyRound size={14} />
                    <span>{provider.credentialSource === "ui" ? "Configured in UI" : provider.credentialSource === "env" ? "Configured via .env" : "Not configured"}</span>
                    {provider.maskedCredential && <small>{provider.maskedCredential}</small>}
                  </div>
                  {provider.credentialFields.map((field) => (
                    <label key={field.key} className={styles.compactField}>
                      <span>{field.label}</span>
                      <input
                        type={field.secret ? "password" : "text"}
                        value={credentials[provider.providerKey]?.[field.key] || ""}
                        placeholder={provider.hasCredentials ? "Saved credential" : field.required ? "Required" : "Optional"}
                        onChange={(event) => setCredentials((current) => ({
                          ...current,
                          [provider.providerKey]: {
                            ...(current[provider.providerKey] || {}),
                            [field.key]: event.target.value,
                          },
                        }))}
                      />
                    </label>
                  ))}
                  {provider.credentialSource === "ui" && (
                    <button type="button" className={styles.textButton} disabled={!!currentBusy} onClick={() => removeCredentials(provider)}>
                      <Trash2 size={14} />
                      Remove saved credential
                    </button>
                  )}
                </div>
              ) : (
                <p className={styles.noCredentialText}>No credential fields required.</p>
              )}

              <div className={styles.lastTestRow} data-status={provider.lastTestStatus || "idle"}>
                {provider.lastTestStatus === "ok" ? <CheckCircle2 size={14} /> : provider.lastTestStatus === "failed" ? <XCircle size={14} /> : <Activity size={14} />}
                <span>{formatLastTest(provider)}</span>
              </div>

              {providerMessage?.text && (
                <p className={providerMessage.type === "ok" ? styles.successText : styles.errorText}>{providerMessage.text}</p>
              )}

              <div className={styles.cardActions}>
                <button type="button" className={styles.secondaryButton} disabled={!!currentBusy} onClick={() => test(provider)}>
                  {currentBusy === "test" ? <Loader2 size={15} className={styles.spinIcon} /> : <Activity size={15} />}
                  Test Connection
                </button>
                <button type="button" className={styles.primaryButton} disabled={!!currentBusy} onClick={() => save(provider)}>
                  {currentBusy === "save" ? <Loader2 size={15} className={styles.spinIcon} /> : <Save size={15} />}
                  Save
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
