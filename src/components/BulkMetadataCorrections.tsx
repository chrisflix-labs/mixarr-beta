"use client";

import { useEffect, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import styles from "./MetadataCorrections.module.css";

const EVENT = "mixarr-track-selection";
const ALL_EVENT = "mixarr-track-selection-all";

export function TrackSelectionCheckbox({ trackId }: { trackId: string }) {
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const handler = (event: Event) => { const next = (event as CustomEvent<boolean>).detail; setChecked(next); window.dispatchEvent(new CustomEvent(EVENT, { detail: { trackId, checked: next } })); };
    window.addEventListener(ALL_EVENT, handler); return () => window.removeEventListener(ALL_EVENT, handler);
  }, [trackId]);
  return <input type="checkbox" checked={checked} onChange={(event) => { setChecked(event.target.checked); window.dispatchEvent(new CustomEvent(EVENT, { detail: { trackId, checked: event.target.checked } })); }} aria-label="Select track for bulk metadata correction" />;
}

export function SelectAllTracksCheckbox() {
  const [checked, setChecked] = useState(false);
  return <input type="checkbox" checked={checked} onChange={(event) => { setChecked(event.target.checked); window.dispatchEvent(new CustomEvent(ALL_EVENT, { detail: event.target.checked })); }} aria-label="Select all tracks on this page" />;
}

const operationLabels: Record<string, string> = {
  set: "Set BPM", adjust: "Adjust by amount", half: "Divide BPM by 2", double: "Multiply BPM by 2",
  set_mood: "Set moods", add_mood: "Add moods", remove_mood: "Remove moods", replace_mood: "Replace moods",
  set_energy: "Set energy", adjust_energy: "Adjust energy", verify: "Mark verified", unverify: "Remove verification",
  ignore_source: "Ignore source", restore_source: "Restore source", remove_correction: "Remove manual corrections",
};

function options(field: string) {
  const correction = field === "bpm" ? ["set","adjust","half","double"] : field === "mood" ? ["set_mood","add_mood","remove_mood","replace_mood"] : ["set_energy","adjust_energy"];
  return [...correction,"verify","unverify","ignore_source","restore_source","remove_correction"];
}

export default function BulkMetadataCorrections() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [field, setField] = useState("bpm"); const [operation, setOperation] = useState("set");
  const [value, setValue] = useState(""); const [source, setSource] = useState("api"); const [reason, setReason] = useState("");
  const [moodValues, setMoodValues] = useState<string[]>([]); const [replacementMoods, setReplacementMoods] = useState<string[]>([]);
  const [moodOptions, setMoodOptions] = useState<string[]>(["Ambient","Chill","Dark","Emotional","Energetic","Focus","Happy","Hype","Intense","Mellow","Moody","Party","Relaxed","Sad","Upbeat","Workout"]);
  const [preview, setPreview] = useState<any>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null);
  const [feedbackAction, setFeedbackAction] = useState("LIKE_TRACKS");
  useEffect(() => { const handler = (event: Event) => { const { trackId, checked } = (event as CustomEvent<{trackId:string;checked:boolean}>).detail; setSelected((current) => { const next = new Set(current); if (checked) next.add(trackId); else next.delete(trackId); return next; }); }; window.addEventListener(EVENT, handler); return () => window.removeEventListener(EVENT, handler); }, []);
  useEffect(() => { fetch("/api/mood-tags").then((response) => response.ok ? response.json() : null).then((data) => { if (data?.moods?.length) setMoodOptions(data.moods.map((item:any) => item.name)); }).catch(() => undefined); }, []);
  function operationValue() { if (operation === "replace_mood") return { from: moodValues, to: replacementMoods }; if (field === "mood") return moodValues; return value === "" ? undefined : Number(value); }
  function selectedOptions(event: React.ChangeEvent<HTMLSelectElement>) { return Array.from(event.target.selectedOptions).map((option) => option.value); }
  async function submit(confirm: boolean) {
    setBusy(true); setError(null); setMessage(null);
    try { const response = await fetch("/api/tracks/metadata-corrections/bulk", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ trackIds:Array.from(selected), field, operation, value:operationValue(), source, reason, confirm }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Bulk correction failed"); if (confirm) { setPreview(null); setMessage(`Updated ${data.summary.changing} track${data.summary.changing === 1 ? "" : "s"}. Batch ${data.batchId}`); window.location.reload(); } else setPreview(data); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Bulk correction failed"); } finally { setBusy(false); }
  }
  async function submitFeedback() {
    const never = feedbackAction === "NEVER_RECOMMEND_TRACKS";
    if (never && !window.confirm(`Never recommend all ${selected.size} selected tracks? Existing playlists will not be changed.`)) return;
    setBusy(true); setError(null); setMessage(null);
    try { const response = await fetch("/api/feedback/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: feedbackAction, trackIds: Array.from(selected), confirmNeverRecommend: never }) }); const data = await response.json(); if (!response.ok && response.status !== 207) throw new Error(data.error?.message || "Bulk feedback failed"); setMessage(`Feedback saved for ${data.affectedTracks || 0} track${data.affectedTracks === 1 ? "" : "s"} and ${data.affectedArtists || 0} artist${data.affectedArtists === 1 ? "" : "s"}${data.failures?.length ? `; ${data.failures.length} failed` : ""}.`); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Bulk feedback failed"); } finally { setBusy(false); }
  }
  function changeField(next: string) { setField(next); setOperation(options(next)[0]); setPreview(null); }
  const needsValue = !["half","double","verify","unverify","ignore_source","restore_source","remove_correction"].includes(operation);
  const needsSource = ["verify","unverify","ignore_source","restore_source"].includes(operation);
  return <>
    <div className={styles.bulkBar} aria-label="Bulk metadata corrections">
      <span>{selected.size} selected</span>
      <label className={styles.label}>Field<select className={styles.select} value={field} onChange={(e) => changeField(e.target.value)}><option value="bpm">BPM</option><option value="mood">Mood</option><option value="energy">Energy</option></select></label>
      <label className={styles.label}>Operation<select className={styles.select} value={operation} onChange={(e) => setOperation(e.target.value)}>{options(field).map((item) => <option key={item} value={item}>{operationLabels[item]}</option>)}</select></label>
      {needsValue && field !== "mood" && <label className={styles.label}>Value<input className={styles.input} type="number" step={field === "bpm" ? ".01" : ".001"} value={value} onChange={(e) => setValue(e.target.value)} /></label>}
      {needsValue && field === "mood" && <label className={styles.label}>{operation === "replace_mood" ? "Moods to replace" : "Moods"}<select multiple className={styles.select} value={moodValues} onChange={(event) => setMoodValues(selectedOptions(event))} aria-label={operation === "replace_mood" ? "Moods to replace" : "Moods to apply"}>{moodOptions.map((mood) => <option value={mood} key={mood}>{mood}</option>)}</select></label>}
      {operation === "replace_mood" && <label className={styles.label}>Replacement moods<select multiple className={styles.select} value={replacementMoods} onChange={(event) => setReplacementMoods(selectedOptions(event))}>{moodOptions.map((mood) => <option value={mood} key={mood}>{mood}</option>)}</select></label>}
      {needsSource && <label className={styles.label}>Source<select className={styles.select} value={source} onChange={(e) => setSource(e.target.value)}><option value="api">API</option><option value="local">Local</option><option value="embedded">Embedded</option><option value="imported">Imported</option><option value="manual">Manual</option></select></label>}
      <button className={`${styles.button} ${styles.primary}`} disabled={!selected.size || busy} onClick={() => void submit(false)}><SlidersHorizontal size={14}/> Preview bulk change</button>
      <label className={styles.label}>Feedback<select className={styles.select} value={feedbackAction} onChange={(event) => setFeedbackAction(event.target.value)}><option value="LIKE_TRACKS">Like tracks</option><option value="DISLIKE_TRACKS">Dislike tracks</option><option value="NEVER_RECOMMEND_TRACKS">Never recommend tracks</option><option value="CLEAR_TRACK_FEEDBACK">Clear track feedback</option><option value="PREFER_ARTISTS">Prefer artists</option><option value="RECOMMEND_LESS_ARTISTS">Recommend less from artists</option></select></label>
      <button className={styles.button} disabled={!selected.size || busy} onClick={() => void submitFeedback()}>Apply feedback ({selected.size})</button>
      {message && <span className={styles.muted}>{message}</span>}{error && <span className={styles.error}>{error}</span>}
    </div>
    {preview && <div className={styles.backdrop}><section className={styles.modal} role="dialog" aria-modal="true" aria-label="Bulk correction preview"><header className={styles.header}><div><h2>Bulk {field.toUpperCase()} Correction</h2><p>Review every impact before applying this transactional batch.</p></div><button className={styles.close} onClick={() => setPreview(null)}><X/></button></header><div className={styles.body}>
      <div className={styles.previewGrid}><div className={styles.previewStat}><strong>{preview.summary.selected}</strong>Selected tracks</div><div className={styles.previewStat}><strong>{preview.summary.changing}</strong>Tracks changing</div><div className={styles.previewStat}><strong>{preview.summary.skipped}</strong>Tracks skipped</div><div className={styles.previewStat}><strong>{preview.summary.existingManualCorrectionsReplaced}</strong>Manual corrections replaced</div></div>
      {preview.summary.warnings.length > 0 && <div className={`${styles.status} ${styles.error}`}>{preview.summary.warnings.length} validation warning(s). Invalid tracks will be skipped.</div>}
      <label className={styles.label}>Reason for this batch (optional)<textarea className={styles.textarea} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <div style={{overflowX:"auto"}}><table className={styles.previewTable}><thead><tr><th>Track</th><th>Existing</th><th>Proposed</th><th>Status</th></tr></thead><tbody>{preview.tracks.map((item:any) => <tr key={item.trackId}><td>{item.title}</td><td>{JSON.stringify(item.oldValue)}</td><td>{JSON.stringify(item.newValue)}</td><td>{item.warning || (item.changes ? "Will change" : "Skipped")}</td></tr>)}</tbody></table></div>
      <div className={styles.actions}><button className={styles.button} disabled={busy} onClick={() => setPreview(null)}>Cancel</button><button className={`${styles.button} ${styles.primary}`} disabled={busy || preview.summary.changing === 0} onClick={() => void submit(true)}>{busy ? "Applying…" : "Apply corrections"}</button></div>
    </div></section></div>}
  </>;
}
