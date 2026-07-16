"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Brain, CalendarDays, Car, Check, Compass, Copy, Guitar, Pencil, Plus, Snowflake, Sun, Trash2, X, Zap } from "lucide-react";
import { discoveryLabel, energyLabel, type ContextInfluence, type ContextProfile, type ContextSelection } from "@/lib/contextualMixes";
import type { SmartMixTuningConfig } from "@/lib/smartMixEngine/v2/tuning";
import styles from "./ContextualMixesPanel.module.css";

type ContextChange = { key: string; before: any; after: any };
type Props = {
  currentTuning: SmartMixTuningConfig;
  selection: ContextSelection | null;
  manualOverrides: string[];
  defaultTuning: SmartMixTuningConfig | null;
  onApply: (value: { context: ContextSelection; tuningConfig: SmartMixTuningConfig; changes: ContextChange[] }) => void;
  onClear: () => void;
  onRestoreField: (key: string) => void;
  onResetAll: () => void;
};

const iconMap: Record<string, any> = { brain: Brain, calendar: CalendarDays, car: Car, compass: Compass, guitar: Guitar, snowflake: Snowflake, sun: Sun, zap: Zap };
const labels: Record<string, string> = { familiarityDiscoveryBalance: "Familiarity", popularityWeight: "Popularity weight", energyWeight: "Energy emphasis", moodWeight: "Mood emphasis", bpmWeight: "BPM emphasis", artistVariety: "Artist variety", albumVariety: "Album variety", avoidRecentlyUsedTracks: "Recently used tracks", discovery: "Discovery", bpmFlow: "BPM flow" };
const human = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const displayValue = (value: any) => typeof value === "boolean" ? (value ? "Enabled" : "Disabled") : typeof value === "object" ? (value?.level ? human(value.level) : value?.mode ? human(value.mode) : "Updated") : String(Math.round(Number(value)) || value);

function emptyProfile(): any {
  return { name: "", description: "", icon: "sparkles", tags: [], contextType: "CUSTOM", isEnabled: true, availability: { timeOfDay: [], daysOfWeek: [], seasons: [], activities: [], startTime: null, endTime: null }, behavior: { targetEnergy: 50, energyRangeMin: 25, energyRangeMax: 75, discoveryLevel: 50, familiarityWeight: 50, popularityWeight: 50, targetBpmMin: null, targetBpmMax: null, bpmFlowMode: "NATURAL", preferredMoods: [], avoidedMoods: [], artistVariety: 50, albumVariety: 50, repeatTolerance: 50, preferRecentAdditions: false, avoidRecentlyPlayed: true, preferDeepCuts: false, preferKnownFavorites: false } };
}

export default function ContextualMixesPanel({ currentTuning, selection, manualOverrides, defaultTuning, onApply, onClear, onRestoreField, onResetAll }: Props) {
  const [profiles, setProfiles] = useState<ContextProfile[]>([]);
  const [suggested, setSuggested] = useState<ContextProfile[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [influence, setInfluence] = useState<ContextInfluence>(selection?.influence || "BALANCED");
  const [pending, setPending] = useState<ContextProfile | null>(null);
  const [changes, setChanges] = useState<ContextChange[]>([]);
  const [editor, setEditor] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await axios.get("/api/contextual-mixes");
      setProfiles([...(response.data.builtInProfiles || []), ...(response.data.customProfiles || [])]);
      setSuggested(response.data.suggestedProfiles || []);
      setSettings(response.data.settings || null);
      if (!selection && response.data.settings?.defaultInfluence) setInfluence(response.data.settings.defaultInfluence);
    } catch (err: any) { setError(err.response?.data?.error || "Context profiles could not be loaded."); }
  }, [selection]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (selection) setInfluence(selection.influence); }, [selection]);

  const apply = async (profile: ContextProfile, mode: "REPLACE" | "UNSET_ONLY") => {
    setError("");
    try {
      const response = await axios.post("/api/contextual-mixes/apply", { profileId: profile.id, influence, currentTuning, mode, manualFields: manualOverrides });
      setChanges(response.data.changes || []);
      onApply(response.data);
      setPending(null);
    } catch (err: any) { setError(err.response?.data?.error || "Context could not be applied."); }
  };

  const selectProfile = (profile: ContextProfile) => {
    setPending(profile);
  };

  const saveProfile = async () => {
    setSaving(true); setError("");
    try {
      const payload = { ...editor, tags: editor.tags || [], availability: editor.availability, behavior: { ...editor.behavior, preferredMoods: String(editor.behavior.preferredMoods || "").split(",").map((v) => v.trim()).filter(Boolean), avoidedMoods: String(editor.behavior.avoidedMoods || "").split(",").map((v) => v.trim()).filter(Boolean), targetBpmMin: editor.behavior.targetBpmMin || null, targetBpmMax: editor.behavior.targetBpmMax || null } };
      if (editor.id) await axios.put(`/api/contextual-mixes/${editor.id}`, payload);
      else await axios.post("/api/contextual-mixes", payload);
      setEditor(null); await load();
    } catch (err: any) { setError(err.response?.data?.error || "Context profile could not be saved."); }
    finally { setSaving(false); }
  };

  const editProfile = (profile: ContextProfile) => setEditor({ ...profile, behavior: { ...profile.behavior, preferredMoods: profile.behavior.preferredMoods.join(", "), avoidedMoods: profile.behavior.avoidedMoods.join(", ") } });
  const cloneProfile = async (profile: ContextProfile) => { try { await axios.post(`/api/contextual-mixes/${profile.id}/clone`, {}); await load(); } catch (err: any) { setError(err.response?.data?.error || "Context could not be cloned."); } };
  const deleteProfile = async (profile: ContextProfile) => { if (!confirm(`Delete "${profile.name}"?`)) return; try { await axios.delete(`/api/contextual-mixes/${profile.id}`); if (selection?.profileId === profile.id) onClear(); await load(); } catch (err: any) { setError(err.response?.data?.error || "Context could not be deleted."); } };
  const resetClone = async (profile: ContextProfile) => { if (!confirm(`Reset "${profile.name}" to the latest built-in defaults?`)) return; try { await axios.post(`/api/contextual-mixes/${profile.id}/reset`); await load(); } catch (err: any) { setError(err.response?.data?.error || "Context could not be reset."); } };
  const toggleAvailability = (key: "daysOfWeek" | "seasons", value: string) => {
    const values = editor.availability[key] as string[];
    setEditor({ ...editor, availability: { ...editor.availability, [key]: values.includes(value) ? values.filter((item) => item !== value) : [...values, value] } });
  };

  if (settings && !settings.enabled) return <section className={styles.panel}><h3>Contextual Mixes</h3><p>Contextual Mixes are disabled in your settings.</p></section>;

  return <section className={styles.panel} aria-labelledby="contextual-mixes-heading">
    <div className={styles.header}>
      <div><h3 id="contextual-mixes-heading">Contextual Mixes</h3><p>Start with a real-world listening context, then adjust every setting yourself.</p></div>
      <button type="button" className={styles.secondary} onClick={() => setEditor(emptyProfile())}><Plus size={16} /> Create custom context</button>
    </div>
    {error && <div className={styles.error} role="alert">{error}<button onClick={load}>Retry</button></div>}
    {suggested.length > 0 && <div className={styles.suggested}><strong>Suggested now</strong><span>{suggested.map((profile) => profile.name).join(" · ")}</span><small>Based only on your configured local time and day.</small></div>}
    <div className={styles.influence}>
      <label htmlFor="context-influence"><strong>Context influence</strong><span>{influence === "LOW" ? "A light suggestion." : influence === "STRONG" ? "Prioritize context within a safe cap." : "Meaningfully guide the mix."}</span></label>
      <select id="context-influence" value={influence} onChange={(event) => setInfluence(event.target.value as ContextInfluence)}><option value="LOW">Low</option><option value="BALANCED">Balanced</option><option value="STRONG">Strong</option></select>
    </div>
    <div className={styles.grid} role="list" aria-label="Available listening contexts">
      <button type="button" className={`${styles.card} ${!selection ? styles.selected : ""}`} aria-pressed={!selection} onClick={onClear}>
        <span className={styles.cardTop}><X size={20} /><strong>Start without a context</strong></span><p>Keep your current Smart Mix settings unchanged.</p>
      </button>
      {profiles.map((profile) => {
        const Icon = iconMap[profile.icon || ""] || CalendarDays;
        const isSelected = selection?.profileId === profile.id;
        return <article key={profile.id} className={`${styles.card} ${isSelected ? styles.selected : ""}`} role="listitem">
          <button type="button" className={styles.cardSelect} onClick={() => selectProfile(profile)} disabled={!profile.isEnabled} aria-pressed={isSelected} aria-label={`Apply ${profile.name}`}>
            <span className={styles.cardTop}><Icon size={20} aria-hidden="true" /><strong>{profile.name}</strong>{!profile.isEnabled && <em>Disabled</em>}{isSelected && <Check size={17} />}</span>
            <p>{profile.description}</p>
            <span className={styles.badges}>{[...profile.availability.timeOfDay, ...profile.availability.daysOfWeek, ...profile.availability.seasons, ...profile.availability.activities].slice(0, 4).map((item) => <em key={item}>{human(item)}</em>)}</span>
            <span className={styles.metrics}><span>Energy <b>{energyLabel(profile.behavior.targetEnergy)}</b></span><span>Discovery <b>{discoveryLabel(profile.behavior.discoveryLevel)}</b></span><span>BPM <b>{human(profile.behavior.bpmFlowMode)}</b></span></span>
            <small>Mood: {profile.behavior.preferredMoods.join(" · ") || "Flexible"} · {profile.isBuiltIn ? "Built-in" : "Custom"}</small>
          </button>
          <div className={styles.cardActions}>
            <button type="button" onClick={() => cloneProfile(profile)}><Copy size={14} /> {profile.isBuiltIn ? "Clone" : "Duplicate"}</button>
            {!profile.isBuiltIn && <><button type="button" onClick={() => editProfile(profile)}><Pencil size={14} /> Edit</button>{profile.clonedFromBuiltInKey && <button type="button" onClick={() => resetClone(profile)}>Reset defaults</button>}<button type="button" onClick={() => deleteProfile(profile)}><Trash2 size={14} /> Delete</button></>}
          </div>
        </article>;
      })}
    </div>
    {!profiles.some((profile) => !profile.isBuiltIn) && <div className={styles.empty}><strong>No custom contexts yet</strong><span>Create one for a commute, coding session, weekend cleaning, or dinner party.</span></div>}
    {selection && <details className={styles.summary} open>
      <summary><strong>Context applied: {selection.profileName}</strong><span>{changes.length} setting{changes.length === 1 ? "" : "s"} changed</span></summary>
      <div className={styles.changeList}>{changes.map((change) => <div key={change.key}><strong>{labels[change.key] || human(change.key)}</strong><span>{displayValue(change.before)} → {displayValue(change.after)}</span></div>)}</div>
      <div className={styles.sources}><span>Context defaults: {selection.profileName}</span><span>Playlist identity: preserved during scoring</span><span>Personalization: applied independently</span><span>Manual overrides: {manualOverrides.length || "None"}</span></div>
      {manualOverrides.length > 0 && <div className={styles.overrides}>{manualOverrides.map((key) => <div key={key}><span><strong>{labels[key] || human(key)}</strong> · Customized{defaultTuning ? ` from ${displayValue((defaultTuning as any)[key])}` : ""}</span><button type="button" onClick={() => onRestoreField(key)}>Restore context default</button></div>)}<button type="button" className={styles.secondary} onClick={onResetAll}>Reset all settings to context defaults</button></div>}
    </details>}

    {pending && <div className={styles.modalBackdrop} role="presentation"><div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="apply-context-title">
      <h3 id="apply-context-title">Apply {pending.name}?</h3><p>This updates energy, discovery, mood, BPM flow, and variety. Playlist name, library, exclusions, and locked tracks are not changed.</p>
      <ul><li>Energy: {energyLabel(pending.behavior.targetEnergy)}</li><li>Discovery: {discoveryLabel(pending.behavior.discoveryLevel)}</li><li>Moods: {pending.behavior.preferredMoods.join(", ") || "Flexible"}</li><li>BPM flow: {human(pending.behavior.bpmFlowMode)}</li></ul>
      <div className={styles.modalActions}><button className={styles.primary} onClick={() => apply(pending, "REPLACE")}>Apply context</button><button className={styles.secondary} onClick={() => apply(pending, "UNSET_ONLY")}>Apply only unset values</button><button className={styles.secondary} onClick={() => setPending(null)}>Cancel</button></div>
    </div></div>}

    {editor && <div className={styles.modalBackdrop} role="presentation"><div className={`${styles.modal} ${styles.editor}`} role="dialog" aria-modal="true" aria-labelledby="context-editor-title">
      <div className={styles.header}><h3 id="context-editor-title">{editor.id ? "Edit custom context" : "Create custom context"}</h3><button aria-label="Close editor" onClick={() => setEditor(null)}><X /></button></div>
      <div className={styles.formGrid}>
        <label>Name<input value={editor.name} maxLength={120} onChange={(e) => setEditor({ ...editor, name: e.target.value })} /></label>
        <label>Icon<select value={editor.icon || "sparkles"} onChange={(e) => setEditor({ ...editor, icon: e.target.value })}><option value="sparkles">Sparkles</option><option value="brain">Focus</option><option value="car">Driving</option><option value="zap">Energy</option><option value="sun">Sun</option><option value="snowflake">Snow</option></select></label>
        <label className={styles.wide}>Description<textarea value={editor.description || ""} maxLength={500} onChange={(e) => setEditor({ ...editor, description: e.target.value })} /></label>
        <label>Activity<select value={editor.availability.activities[0] || ""} onChange={(e) => setEditor({ ...editor, availability: { ...editor.availability, activities: e.target.value ? [e.target.value] : [] } })}><option value="">Any activity</option>{["WORKOUT", "DRIVING", "FOCUS", "PARTY", "RELAXATION"].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Time of day<select value={editor.availability.timeOfDay[0] || ""} onChange={(e) => setEditor({ ...editor, availability: { ...editor.availability, timeOfDay: e.target.value ? [e.target.value] : [] } })}><option value="">Any time</option>{["EARLY_MORNING", "MORNING", "AFTERNOON", "EVENING", "LATE_NIGHT"].map((item) => <option key={item}>{item}</option>)}</select></label>
        <fieldset className={`${styles.checkboxGroup} ${styles.wide}`}><legend>Days of week</legend>{["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"].map((item) => <label key={item}><input type="checkbox" checked={editor.availability.daysOfWeek.includes(item)} onChange={() => toggleAvailability("daysOfWeek", item)} />{human(item)}</label>)}</fieldset>
        <fieldset className={`${styles.checkboxGroup} ${styles.wide}`}><legend>Seasons</legend>{["SPRING", "SUMMER", "AUTUMN", "WINTER"].map((item) => <label key={item}><input type="checkbox" checked={editor.availability.seasons.includes(item)} onChange={() => toggleAvailability("seasons", item)} />{human(item)}</label>)}</fieldset>
        <label>Advanced start time<input type="time" value={editor.availability.startTime || ""} onChange={(e) => setEditor({ ...editor, availability: { ...editor.availability, startTime: e.target.value || null } })} /></label>
        <label>Advanced end time<input type="time" value={editor.availability.endTime || ""} onChange={(e) => setEditor({ ...editor, availability: { ...editor.availability, endTime: e.target.value || null } })} /><small>Cross-midnight ranges are supported.</small></label>
        <label>Energy target <b>{editor.behavior.targetEnergy}</b><input type="range" min="0" max="100" value={editor.behavior.targetEnergy} onChange={(e) => setEditor({ ...editor, behavior: { ...editor.behavior, targetEnergy: Number(e.target.value) } })} /></label>
        <label>Energy minimum <b>{editor.behavior.energyRangeMin}</b><input type="range" min="0" max="100" value={editor.behavior.energyRangeMin} onChange={(e) => setEditor({ ...editor, behavior: { ...editor.behavior, energyRangeMin: Number(e.target.value) } })} /></label>
        <label>Energy maximum <b>{editor.behavior.energyRangeMax}</b><input type="range" min="0" max="100" value={editor.behavior.energyRangeMax} onChange={(e) => setEditor({ ...editor, behavior: { ...editor.behavior, energyRangeMax: Number(e.target.value) } })} /></label>
        <label>Discovery <b>{editor.behavior.discoveryLevel}</b><input type="range" min="0" max="100" value={editor.behavior.discoveryLevel} onChange={(e) => setEditor({ ...editor, behavior: { ...editor.behavior, discoveryLevel: Number(e.target.value) } })} /></label>
        <label>Familiarity <b>{editor.behavior.familiarityWeight}</b><input type="range" min="0" max="100" value={editor.behavior.familiarityWeight} onChange={(e) => setEditor({ ...editor, behavior: { ...editor.behavior, familiarityWeight: Number(e.target.value) } })} /></label>
        <label>Popularity weight <b>{editor.behavior.popularityWeight}</b><input type="range" min="0" max="100" value={editor.behavior.popularityWeight} onChange={(e) => setEditor({ ...editor, behavior: { ...editor.behavior, popularityWeight: Number(e.target.value) } })} /></label>
        <label>Artist variety <b>{editor.behavior.artistVariety}</b><input type="range" min="0" max="100" value={editor.behavior.artistVariety} onChange={(e) => setEditor({ ...editor, behavior: { ...editor.behavior, artistVariety: Number(e.target.value) } })} /></label>
        <label>Album variety <b>{editor.behavior.albumVariety}</b><input type="range" min="0" max="100" value={editor.behavior.albumVariety} onChange={(e) => setEditor({ ...editor, behavior: { ...editor.behavior, albumVariety: Number(e.target.value) } })} /></label>
        <label>Repeat tolerance <b>{editor.behavior.repeatTolerance}</b><input type="range" min="0" max="100" value={editor.behavior.repeatTolerance} onChange={(e) => setEditor({ ...editor, behavior: { ...editor.behavior, repeatTolerance: Number(e.target.value) } })} /></label>
        <label>BPM minimum<input type="number" min="30" max="300" value={editor.behavior.targetBpmMin || ""} onChange={(e) => setEditor({ ...editor, behavior: { ...editor.behavior, targetBpmMin: e.target.value } })} /></label>
        <label>BPM maximum<input type="number" min="30" max="300" value={editor.behavior.targetBpmMax || ""} onChange={(e) => setEditor({ ...editor, behavior: { ...editor.behavior, targetBpmMax: e.target.value } })} /></label>
        <label>BPM flow<select value={editor.behavior.bpmFlowMode} onChange={(e) => setEditor({ ...editor, behavior: { ...editor.behavior, bpmFlowMode: e.target.value } })}>{["NATURAL", "STEADY", "RAMP_UP", "RAMP_DOWN", "DISABLED"].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className={styles.wide}>Preferred moods (comma separated)<input value={editor.behavior.preferredMoods} onChange={(e) => setEditor({ ...editor, behavior: { ...editor.behavior, preferredMoods: e.target.value } })} /></label>
        <label className={styles.wide}>Avoided moods (comma separated)<input value={editor.behavior.avoidedMoods} onChange={(e) => setEditor({ ...editor, behavior: { ...editor.behavior, avoidedMoods: e.target.value } })} /></label>
        <label className={styles.checkbox}><input type="checkbox" checked={editor.behavior.preferDeepCuts} onChange={(e) => setEditor({ ...editor, behavior: { ...editor.behavior, preferDeepCuts: e.target.checked } })} /> Prefer deep cuts</label>
        <label className={styles.checkbox}><input type="checkbox" checked={editor.behavior.avoidRecentlyPlayed} onChange={(e) => setEditor({ ...editor, behavior: { ...editor.behavior, avoidRecentlyPlayed: e.target.checked } })} /> Avoid recently used tracks</label>
        <label className={styles.checkbox}><input type="checkbox" checked={editor.behavior.preferRecentAdditions} onChange={(e) => setEditor({ ...editor, behavior: { ...editor.behavior, preferRecentAdditions: e.target.checked } })} /> Prefer recent additions</label>
        <label className={styles.checkbox}><input type="checkbox" checked={editor.behavior.preferKnownFavorites} onChange={(e) => setEditor({ ...editor, behavior: { ...editor.behavior, preferKnownFavorites: e.target.checked } })} /> Prefer known favorites</label>
        <label className={styles.checkbox}><input type="checkbox" checked={editor.isEnabled} onChange={(e) => setEditor({ ...editor, isEnabled: e.target.checked })} /> Context enabled</label>
      </div>
      <div className={styles.modalActions}><button className={styles.primary} disabled={saving || !editor.name.trim()} onClick={saveProfile}>{saving ? "Saving…" : "Save context"}</button><button className={styles.secondary} onClick={() => setEditor(null)}>Cancel</button></div>
    </div></div>}
  </section>;
}
