"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, History, PencilLine, SlidersHorizontal, X } from "lucide-react";
import styles from "./MetadataCorrections.module.css";

type Field = "bpm" | "mood" | "energy";
const fields: Field[] = ["bpm", "mood", "energy"];

function display(value: unknown, field?: Field) {
  if (value == null) return "Missing";
  if (Array.isArray(value)) return value.join(", ") || "Missing";
  if (typeof value === "number") return field === "bpm" ? `${value} BPM` : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return String(value);
}

async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

export default function MetadataCorrectionsButton({ trackId, corrected = false, verified = false, conflict = false }: { trackId: string; corrected?: boolean; verified?: boolean; conflict?: boolean }) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<any>(null);
  const [history, setHistory] = useState<any[] | null>(null);
  const [editing, setEditing] = useState<Field | null>(null);
  const [value, setValue] = useState("");
  const [moods, setMoods] = useState<string[]>([]);
  const [moodOptions, setMoodOptions] = useState<string[]>(["Ambient","Chill","Dark","Emotional","Energetic","Focus","Happy","Hype","Intense","Mellow","Moody","Party","Relaxed","Sad","Upbeat","Workout"]);
  const [moodSearch, setMoodSearch] = useState("");
  const [reason, setReason] = useState("");
  const [isVerified, setIsVerified] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setDetails(await jsonRequest(`/api/tracks/${trackId}/metadata-corrections`)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load metadata"); }
    finally { setBusy(false); }
  }, [trackId]);

  useEffect(() => { if (open) { void load(); jsonRequest("/api/mood-tags").then((data) => setMoodOptions((data.moods || []).map((item: any) => item.name))).catch(() => undefined); } }, [load, open]);
  const activeCorrections = useMemo(() => new Map((details?.corrections || []).filter((item: any) => item.isActive).map((item: any) => [item.field, item])), [details]);

  function begin(field: Field) {
    const correction: any = activeCorrections.get(field);
    const current = correction?.valueJson ?? details?.effectiveMetadata?.[field]?.value;
    setEditing(field); setReason(correction?.reason || ""); setIsVerified(correction?.isVerified !== false);
    if (field === "mood") setMoods(Array.isArray(current) ? current : []); else setValue(current == null ? "" : String(current));
  }

  async function mutate(url: string, method: string, body: unknown, success: string) {
    setBusy(true); setError(null); setMessage(null);
    try { setDetails(await jsonRequest(url, { method, body: JSON.stringify(body) })); setMessage(success); setEditing(null); setHistory(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Update failed"); }
    finally { setBusy(false); }
  }

  async function save(field: Field) {
    await mutate(`/api/tracks/${trackId}/metadata-corrections`, "POST", { field, value: field === "mood" ? moods : Number(value), reason, verified: isVerified }, `${field.toUpperCase()} correction saved.`);
  }

  async function loadHistory() {
    setBusy(true); setError(null);
    try { const data = await jsonRequest(`/api/tracks/${trackId}/metadata-correction-history`); setHistory(data.history); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load history"); }
    finally { setBusy(false); }
  }

  return <>
    <button type="button" className={styles.trigger} onClick={() => setOpen(true)} aria-label="Metadata corrections" title="Metadata corrections">
      <SlidersHorizontal size={16} />
    </button>
    {open && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setOpen(false); }}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Metadata Corrections">
        <header className={styles.header}><div><h2>Metadata Corrections</h2><p>{details ? `${details.track.title} — ${details.track.artist}` : "Loading track metadata…"}</p></div><button className={styles.close} onClick={() => setOpen(false)} aria-label="Close"><X /></button></header>
        <div className={styles.body}>
          {(corrected || verified || conflict) && <div className={styles.badges}>{corrected && <span className={`${styles.badge} ${styles.manual}`}>MANUAL</span>}{verified && <span className={`${styles.badge} ${styles.verified}`}>VERIFIED</span>}{conflict && <span className={`${styles.badge} ${styles.conflict}`}>CONFLICT</span>}</div>}
          {message && <div className={styles.status} role="status">{message}</div>}{error && <div className={`${styles.status} ${styles.error}`} role="alert">{error}</div>}
          {details && !history && fields.map((field) => {
            const effective = details.effectiveMetadata[field]; const correction: any = activeCorrections.get(field); const sources = details.sources[field];
            return <article className={styles.fieldCard} key={field}>
              <div className={styles.fieldTop}><div><h3>{field.toUpperCase()}</h3><p className={styles.muted}>Effective: {display(effective.value, field)} · {effective.source}</p></div><div className={styles.badges}>{effective.corrected && <span className={`${styles.badge} ${styles.manual}`}>MANUAL</span>}{effective.verified && <span className={`${styles.badge} ${styles.verified}`}>VERIFIED</span>}{effective.ignoredSources.length > 0 && <span className={`${styles.badge} ${styles.ignored}`}>IGNORED SOURCE</span>}{effective.conflict && <span className={`${styles.badge} ${styles.conflict}`}>CONFLICT</span>}</div></div>
              <div className={styles.sources}>{Object.entries(sources).map(([source, sourceValue]) => { const sourceVerified = details.verifications.some((item:any) => item.field === field && item.source === source && item.verified); return <div className={styles.source} key={source}><strong>{source}</strong><span>{display(sourceValue, field)}</span>{sourceValue != null && source !== "effectiveStored" && <div className={styles.sourceActions}><button className={styles.small} onClick={() => void mutate(`/api/tracks/${trackId}/metadata-verification`, sourceVerified ? "DELETE" : "POST", { field, source }, sourceVerified ? `${source} verification removed.` : `${source} ${field} verified.`)}>{sourceVerified ? "Unverify" : "Verify"}</button>{["api","local","embedded","imported"].includes(source) && <button className={styles.small} onClick={() => void mutate(`/api/tracks/${trackId}/metadata-source-overrides`, effective.ignoredSources.includes(source) ? "DELETE" : "POST", { field, source }, effective.ignoredSources.includes(source) ? "Source restored." : "Source ignored.")}>{effective.ignoredSources.includes(source) ? "Restore" : "Ignore"}</button>}</div>}</div>; })}</div>
              {editing !== field ? <div className={styles.actions}><button className={styles.button} onClick={() => begin(field)}><PencilLine size={14} /> {correction ? "Edit correction" : "Correct"}</button>{correction && <button className={`${styles.button} ${styles.danger}`} onClick={() => void mutate(`/api/tracks/${trackId}/metadata-corrections/${field}`, "DELETE", { reason: "Manual correction removed" }, "Correction removed; the next trusted source is active.")}>Remove correction</button>}</div> : <div className={styles.edit}>
                {field === "bpm" && <><label className={styles.label}>BPM<input className={styles.input} type="number" min="0.01" max="400" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} /></label><div className={styles.moods}>{details.bpmSuggestions.map((item: any) => <button type="button" className={styles.button} key={`${item.value}-${item.label}`} onClick={() => setValue(String(item.value))}>{item.value} — {item.label}</button>)}</div></>}
                {field === "energy" && <label className={styles.label}>Energy (0–1)<input type="range" min="0" max="1" step="0.01" value={value || "0.5"} onChange={(e) => setValue(e.target.value)} /><input className={styles.input} type="number" min="0" max="1" step="0.001" value={value} onChange={(e) => setValue(e.target.value)} /></label>}
                {field === "mood" && <fieldset className={styles.label}><legend>Select moods</legend><input className={styles.input} type="search" placeholder="Search moods" value={moodSearch} onChange={(event) => setMoodSearch(event.target.value)} /><div className={styles.moods}>{moodOptions.filter((mood) => mood.toLowerCase().includes(moodSearch.trim().toLowerCase())).map((mood) => <label className={styles.mood} key={mood}><input type="checkbox" checked={moods.some((item) => item.toLowerCase() === mood.toLowerCase())} onChange={() => setMoods((current) => current.some((item) => item.toLowerCase() === mood.toLowerCase()) ? current.filter((item) => item.toLowerCase() !== mood.toLowerCase()) : [...current, mood])} />{mood}</label>)}</div></fieldset>}
                <div className={styles.grid}><label className={styles.label}>Reason (optional)<textarea className={styles.textarea} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label><label className={styles.mood}><input type="checkbox" checked={isVerified} onChange={(e) => setIsVerified(e.target.checked)} /><CheckCircle2 size={14} /> Mark correction verified</label></div>
                <div className={styles.actions}><button className={`${styles.button} ${styles.primary}`} disabled={busy} onClick={() => void save(field)}>Save correction</button><button className={styles.button} disabled={busy} onClick={() => setEditing(null)}>Cancel</button></div>
              </div>}
            </article>;
          })}
          {details && !history && <div className={styles.actions}><button className={styles.button} onClick={() => void loadHistory()}><History size={15} /> View correction history</button></div>}
          {history && <section><div className={styles.fieldTop}><h3>Correction history</h3><button className={styles.button} onClick={() => setHistory(null)}>Back</button></div><div className={styles.history}>{history.length ? history.map((item) => <div className={styles.historyItem} key={item.id}><strong>{item.field.toUpperCase()} · {String(item.action).replaceAll("_", " ")}</strong><p>{display(item.oldValueJson)} → {display(item.newValueJson)}{item.source ? ` · ${item.source}` : ""}</p>{item.reason && <p>{item.reason}</p>}<time>{new Date(item.createdAt).toLocaleString()}{item.actor?.username ? ` · ${item.actor.username}` : ""}{item.batchId ? ` · Batch ${item.batchId}` : ""}</time></div>) : <p className={styles.muted}>No correction history yet.</p>}</div></section>}
          {busy && !details && <p className={styles.muted}>Loading…</p>}
        </div>
      </section>
    </div>}
  </>;
}
