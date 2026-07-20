"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity, AlertTriangle, ArrowLeft, BarChart3, BookOpenCheck, CheckCircle2, ChevronRight,
  CircleHelp, Gauge, Layers3, Loader2, Music2, Plus, RotateCcw, Save, Settings2, ShieldCheck,
  SlidersHorizontal, Sparkles, Trash2, Wand2,
} from "lucide-react";
import {
  applyGuidedRecipeAnswers, defaultRecipeStudioDraft, energyCurvePreset, hasAdvancedRecipeSettings,
  validateCurve, type CurvePoint, type GuidedRecipeAnswers, type RecipeStudioMode,
} from "@/lib/recipeStudio";
import styles from "./RecipeStudio.module.css";

type Analysis = Record<string, any>;
type LibraryOption = { id: string; name: string; serverName: string; tracks: number };

const sections = [
  ["identity", "Identity & source", BookOpenCheck], ["candidates", "Candidate requirements", SlidersHorizontal],
  ["energy", "Mood & energy", Activity], ["bpm", "BPM flow", Gauge], ["discovery", "Discovery & variety", Sparkles],
  ["scoring", "Scoring", BarChart3], ["automation", "Approval & automation", ShieldCheck], ["advanced", "Dependencies & advanced", Settings2],
] as const;

const initialAnswers: GuidedRecipeAnswers = { mixStyle: "balanced", libraryId: null, trackCount: 100, discoveryBalance: "balanced", energyShape: "steady", smoothBpm: true, artistRepetition: "balanced", refresh: "manual", requireApproval: true, household: false, insufficientCandidates: "allow_fallback" };

function inputNumber(value: string, fallback: number | null = null) { return value === "" ? fallback : Number(value); }
function list(value: string) { return value.split(",").map((item) => item.trim()).filter(Boolean); }
function humanStatus(value: string) { return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase()); }

export default function RecipeStudio({ recipeId }: { recipeId?: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, any>>(() => defaultRecipeStudioDraft());
  const [baseline, setBaseline] = useState("");
  const [mode, setMode] = useState<RecipeStudioMode>(recipeId ? "beginner" : "guided");
  const [active, setActive] = useState("identity");
  const [guidedStep, setGuidedStep] = useState(0);
  const [answers, setAnswers] = useState<GuidedRecipeAnswers>(initialAnswers);
  const [energyPoints, setEnergyPoints] = useState<CurvePoint[]>(energyCurvePreset("flat"));
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisState, setAnalysisState] = useState<"loading" | "ready" | "stale" | "error" | "unavailable">("loading");
  const [libraries, setLibraries] = useState<LibraryOption[]>([]);
  const [loading, setLoading] = useState(Boolean(recipeId));
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [raw, setRaw] = useState("");
  const analysisAbort = useRef<AbortController | null>(null);
  const firstAnalysis = useRef(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      recipeId ? fetch(`/api/playlist-recipes/${encodeURIComponent(recipeId)}`).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Recipe not found."); return body.recipe; }) : Promise.resolve(null),
      fetch("/api/plex/servers").then((response) => response.ok ? response.json() : { servers: [] }),
    ]).then(([recipe, servers]) => {
      if (cancelled) return;
      const options = (servers.servers || []).flatMap((server: any) => (server.libraries || []).filter((library: any) => library.type === "artist" || library.type === "music" || !library.type).map((library: any) => ({ id: library.id, name: library.name, serverName: server.name, tracks: library._count?.tracks || 0 })));
      setLibraries(options);
      if (recipe) {
        setDraft(recipe); setBaseline(JSON.stringify(recipe)); setAnswers((current) => ({ ...current, libraryId: recipe.filters?.libraryId || options[0]?.id || null, trackCount: recipe.filters?.limit || 100 }));
        const progression = recipe.targets?.energyProgression;
        setEnergyPoints(energyCurvePreset(progression === "rising" || progression === "falling" ? progression : progression === "wave" ? "peak" : "flat"));
      } else {
        setDraft((current) => ({ ...current, filters: { ...current.filters, libraryId: options[0]?.id || null } }));
        setAnswers((current) => ({ ...current, libraryId: options[0]?.id || null }));
      }
    }).catch((caught) => setError(caught instanceof Error ? caught.message : "Recipe Studio could not load.")).finally(() => setLoading(false));
    return () => { cancelled = true; };
  }, [recipeId]);

  const dirty = useMemo(() => Boolean(baseline) ? JSON.stringify(draft) !== baseline : draft.name !== "Untitled Mix Recipe" || draft.description || mode !== "guided", [baseline, draft, mode]);
  const advanced = useMemo(() => hasAdvancedRecipeSettings(draft), [draft]);
  const curveFindings = useMemo(() => validateCurve(energyPoints), [energyPoints]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (loading) return;
    if (!firstAnalysis.current) setAnalysisState("stale");
    const timer = setTimeout(async () => {
      analysisAbort.current?.abort();
      const controller = new AbortController(); analysisAbort.current = controller; setAnalysisState("loading");
      try {
        const response = await fetch("/api/recipes/studio/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipe: draft }), signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Analysis unavailable.");
        setAnalysis(body); setAnalysisState("ready"); firstAnalysis.current = false;
      } catch (caught) {
        if ((caught as Error).name !== "AbortError") setAnalysisState(analysis ? "stale" : "error");
      }
    }, 500);
    return () => { clearTimeout(timer); };
  }, [draft, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  function update(section: string, key: string, value: unknown) { setDraft((current) => ({ ...current, [section]: { ...(current[section] || {}), [key]: value } })); }
  function updateRoot(key: string, value: unknown) { setDraft((current) => ({ ...current, [key]: value })); }
  function selectMode(next: RecipeStudioMode) { setMode(next); setNotice(next === "beginner" && advanced ? "This recipe contains advanced settings. They remain unchanged unless you open Advanced Mode." : ""); }

  function applyGuided() {
    const result = applyGuidedRecipeAnswers(draft, answers);
    setDraft(result); setEnergyPoints(energyCurvePreset(answers.energyShape === "steady" ? "flat" : answers.energyShape)); setMode("beginner"); setActive("identity"); setNotice("Guided answers were mapped into the same recipe document. Review the generated settings before saving.");
  }

  function applyEnergyPreset(preset: "flat" | "rising" | "falling" | "peak" | "dip") {
    const points = energyCurvePreset(preset); setEnergyPoints(points);
    const values = points.map((point) => point.value / 100);
    update("targets", "minimumEnergy", Math.min(...values)); update("targets", "maximumEnergy", Math.max(...values)); update("targets", "targetEnergy", values[Math.floor(values.length / 2)]);
    update("targets", "energyProgression", preset === "flat" ? "steady" : preset === "peak" || preset === "dip" ? "wave" : preset);
  }

  function changePoint(index: number, patch: Partial<CurvePoint>) { setEnergyPoints((current) => current.map((point, pointIndex) => pointIndex === index ? { ...point, ...patch } : point)); }
  function addEnergyPoint() { setEnergyPoints((current) => [...current, { position: 50, value: 50 }].sort((left, right) => left.position - right.position)); }

  async function validate() {
    setValidating(true); setError("");
    try {
      const response = recipeId
        ? await fetch(`/api/playlist-recipes/${encodeURIComponent(recipeId)}/validate`, { method: "POST" })
        : await fetch("/api/recipes/studio/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipe: draft }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Validation failed.");
      const result = body.result || body.compatibility; setNotice(result.valid === false || result.status === "partially_compatible" ? "Validation found items that need attention. Open diagnostics for remediation." : "Validation completed. Review warnings before activation.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Validation failed."); } finally { setValidating(false); }
  }

  async function save() {
    if (curveFindings.some((finding) => finding.severity === "error")) { setError("Fix the energy curve before saving."); setActive("energy"); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      const payload = { name: draft.name, description: draft.description, category: draft.category, artworkUrl: draft.artworkUrl || null, enabled: draft.enabled, filters: draft.filters, scoring: draft.scoring, targets: draft.targets, bpmFlow: draft.bpmFlow, discovery: draft.discovery, variety: draft.variety, playlistIdentity: draft.playlistIdentity, refreshPolicy: draft.refreshPolicy, automationPolicy: draft.automationPolicy, expectedUpdatedAt: draft.updatedAt };
      const response = await fetch(recipeId ? `/api/playlist-recipes/${encodeURIComponent(recipeId)}` : "/api/playlist-recipes", { method: recipeId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 409) throw new Error("This recipe changed while you were editing it. Open the latest version in another tab, compare it, then retry your changes.");
        throw new Error(body.error || "Recipe save failed. No changes were saved.");
      }
      setDraft(body.recipe); setBaseline(JSON.stringify(body.recipe)); setNotice(`Saved recipe v${body.recipe.recipeVersion}.`);
      if (!recipeId) router.replace(`/recipes/${body.recipe.id}/edit`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Recipe save failed. No changes were saved."); } finally { setSaving(false); }
  }

  function loadRaw() { setRaw(JSON.stringify({ filters: draft.filters, scoring: draft.scoring, targets: draft.targets, bpmFlow: draft.bpmFlow, discovery: draft.discovery, variety: draft.variety, playlistIdentity: draft.playlistIdentity, refreshPolicy: draft.refreshPolicy, automationPolicy: draft.automationPolicy }, null, 2)); }
  function applyRaw() { try { const parsed = JSON.parse(raw); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); setDraft((current) => ({ ...current, ...parsed })); setNotice("Structured settings applied to the current draft. Nothing has been saved yet."); } catch { setError("Structured settings must be a valid JSON object."); } }

  if (loading) return <main className={styles.state} aria-busy="true"><Loader2 className="animate-spin" /> Loading Recipe Studio…</main>;
  if (error && recipeId && !draft.id) return <main className={styles.state}><AlertTriangle /> {error}</main>;

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><Link href={recipeId ? `/recipes/${recipeId}` : "/recipes"} className={styles.back}><ArrowLeft size={15} /> Recipe Library</Link><span className={styles.kicker}><Wand2 size={14} /> Recipe Studio</span><h1>{recipeId ? draft.name : "Create a Mix Recipe"}</h1><p>Guided and advanced tools edit one portable, governed recipe document.</p></div>
      <div className={styles.headerActions}><button type="button" onClick={() => void validate()} disabled={validating}>{validating ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Validate</button><button type="button" className={styles.primary} onClick={() => void save()} disabled={saving || !dirty}>{saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {saving ? "Saving…" : dirty ? "Save draft" : "Saved"}</button></div>
    </header>

    <div className={styles.statusBar} role="status" aria-live="polite"><span data-dirty={dirty}>{dirty ? "Unsaved changes" : "All changes saved"}</span><span>Analysis: {analysisState}</span>{draft.updatedAt && <span>Revision updated {new Date(draft.updatedAt).toLocaleString()}</span>}</div>
    {(notice || error) && <div className={error ? styles.error : styles.notice} role={error ? "alert" : "status"}>{error ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}<span>{error || notice}</span>{error && <button onClick={() => setError("")} aria-label="Dismiss error">×</button>}</div>}

    <div className={styles.modeTabs} role="tablist" aria-label="Recipe editing mode">
      {(["guided", "beginner", "advanced"] as RecipeStudioMode[]).map((item) => <button key={item} role="tab" aria-selected={mode === item} data-active={mode === item} onClick={() => selectMode(item)}>{item === "guided" ? <Wand2 size={16} /> : item === "beginner" ? <Sparkles size={16} /> : <Settings2 size={16} />}{humanStatus(item)}</button>)}
    </div>

    {mode === "guided" ? <GuidedBuilder step={guidedStep} answers={answers} libraries={libraries} onStep={setGuidedStep} onAnswers={(patch) => setAnswers((current) => ({ ...current, ...patch }))} onApply={applyGuided} /> : <div className={styles.workspace}>
      <nav className={styles.sectionNav} aria-label="Recipe Studio sections">{sections.map(([id, label, Icon]) => <button key={id} data-active={active === id} onClick={() => setActive(id)}><Icon size={17} /><span>{label}</span><ChevronRight size={14} /></button>)}</nav>
      <section className={styles.editor} aria-label={`${sections.find(([id]) => id === active)?.[1]} editor`}>
        {mode === "beginner" && advanced && <div className={styles.advancedNotice}><CircleHelp size={18} /><div><strong>This recipe contains advanced settings.</strong><p>You can continue using Beginner Mode, but those values remain unchanged unless you open Advanced Mode.</p></div><button onClick={() => setMode("advanced")}>Open Advanced</button></div>}
        {active === "identity" && <Panel title="Identity and source" description="Give the strategy a recognizable identity and choose the library it analyzes.">
          <Field label="Recipe name" hint="Required; up to 120 characters"><input value={draft.name} maxLength={120} onChange={(event) => updateRoot("name", event.target.value)} /></Field>
          <Field label="Description" hint="Explain when and why someone should use it"><textarea rows={4} value={draft.description || ""} maxLength={1000} onChange={(event) => updateRoot("description", event.target.value)} /></Field>
          <div className={styles.two}><Field label="Category"><select value={draft.category} onChange={(event) => updateRoot("category", event.target.value)}>{["Custom","Driving","Workout","Party","Focus","Chill","Sleep","Discovery","Mood","Genre","Seasonal"].map((value) => <option key={value}>{value}</option>)}</select></Field><Field label="Source library"><select value={draft.filters?.libraryId || ""} onChange={(event) => { update("filters", "libraryId", event.target.value || null); update("automationPolicy", "libraryId", event.target.value || null); }}><option value="">Choose a library</option>{libraries.map((library) => <option value={library.id} key={library.id}>{library.serverName} — {library.name} ({library.tracks.toLocaleString()})</option>)}</select></Field></div>
          <label className={styles.toggle}><input type="checkbox" checked={draft.enabled !== false} onChange={(event) => updateRoot("enabled", event.target.checked)} /> Enabled for manual use <small>Activation still requires validation and governance approval.</small></label>
        </Panel>}
        {active === "candidates" && <Panel title="Candidate requirements" description="Set a target size and safe fallback behavior without generating a playlist.">
          <div className={styles.two}><Field label="Playlist size" hint="Recommended: 50–150"><input type="number" min="1" max="5000" value={draft.filters?.limit || 100} onChange={(event) => update("filters", "limit", inputNumber(event.target.value, 100))} /></Field><Field label="When too few tracks match"><select value={draft.targets?.missingEnergyFallback || "allow"} onChange={(event) => { update("targets", "missingEnergyFallback", event.target.value); update("targets", "missingMoodFallback", event.target.value); update("bpmFlow", "missingBpmFallback", event.target.value); }}><option value="allow">Use safe fallbacks</option><option value="neutral">Reduce strictness</option><option value="exclude">Stop rather than relax</option></select></Field></div>
          <div className={styles.two}><Field label="Minimum rating"><input type="number" min="0" max="10" step=".5" value={draft.filters?.negativeFilters?.minRating ?? ""} onChange={(event) => update("filters", "negativeFilters", { ...(draft.filters?.negativeFilters || {}), minRating: inputNumber(event.target.value) })} /></Field><Field label="Avoid recently played for days"><input type="number" min="1" max="3650" value={draft.filters?.negativeFilters?.excludePlayedWithinDays ?? ""} onChange={(event) => update("filters", "negativeFilters", { ...(draft.filters?.negativeFilters || {}), excludePlayedWithinDays: inputNumber(event.target.value) })} /></Field></div>
          {[['excludeExplicit','Exclude explicit tracks'],['excludeLive','Exclude live recordings'],['excludeHoliday','Exclude holiday music'],['excludeRemasters','Exclude remasters']].map(([key,label]) => <label className={styles.toggle} key={key}><input type="checkbox" checked={Boolean(draft.filters?.negativeFilters?.[key])} onChange={(event) => update("filters", "negativeFilters", { ...(draft.filters?.negativeFilters || {}), [key]: event.target.checked })} /> {label}</label>)}
        </Panel>}
        {active === "energy" && <Panel title="Mood and energy progression" description="Choose a preset or edit the accessible control-point table. Values are normalized from 0 to 100.">
          <Field label="Moods" hint="Comma-separated Mixarr mood names"><input value={(draft.targets?.selectedMoods || []).join(", ")} onChange={(event) => update("targets", "selectedMoods", list(event.target.value))} /></Field>
          <div className={styles.presetRow}>{(["flat","rising","falling","peak","dip"] as const).map((preset) => <button key={preset} onClick={() => applyEnergyPreset(preset)}>{humanStatus(preset)}</button>)}<button onClick={addEnergyPoint}><Plus size={14} /> Add point</button><button onClick={() => applyEnergyPreset("flat")}><RotateCcw size={14} /> Reset</button></div>
          <CurveGraphic points={energyPoints} />
          <table className={styles.curveTable}><caption>Keyboard-accessible energy curve control points</caption><thead><tr><th scope="col">Point</th><th scope="col">Position %</th><th scope="col">Energy</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>{energyPoints.map((point, index) => <tr key={`${index}-${point.position}`}><th scope="row">{index + 1}</th><td><input aria-label={`Point ${index + 1} position`} type="number" min="0" max="100" value={point.position} onChange={(event) => changePoint(index, { position: Number(event.target.value) })} /></td><td><input aria-label={`Point ${index + 1} energy`} type="number" min="0" max="100" value={point.value} onChange={(event) => changePoint(index, { value: Number(event.target.value) })} /></td><td><button aria-label={`Remove point ${index + 1}`} disabled={energyPoints.length <= 2} onClick={() => setEnergyPoints((current) => current.filter((_, pointIndex) => pointIndex !== index))}><Trash2 size={15} /></button></td></tr>)}</tbody></table>
          {curveFindings.map((finding) => <p className={styles.inlineError} key={finding.code}><AlertTriangle size={15} /> {finding.message}</p>)}
        </Panel>}
        {active === "bpm" && <Panel title="BPM flow" description="Describe the requested tempo path. The live panel warns when library coverage is unlikely to satisfy it.">
          <div className={styles.three}><NumberField label="Minimum BPM" value={draft.bpmFlow?.minimumBpm} onChange={(value) => update("bpmFlow", "minimumBpm", value)} /><NumberField label="Target BPM" value={draft.bpmFlow?.targetBpm} onChange={(value) => update("bpmFlow", "targetBpm", value)} /><NumberField label="Maximum BPM" value={draft.bpmFlow?.maximumBpm} onChange={(value) => update("bpmFlow", "maximumBpm", value)} /></div>
          <div className={styles.two}><Field label="Flow"><select value={draft.bpmFlow?.mode || "DISABLED"} onChange={(event) => update("bpmFlow", "mode", event.target.value)}>{["DISABLED","NATURAL","RAMP_UP","RAMP_DOWN","STEADY","CUSTOM"].map((value) => <option key={value} value={value}>{humanStatus(value)}</option>)}</select></Field><NumberField label="Allowed transition size" value={draft.bpmFlow?.maximumBpmGap} onChange={(value) => update("bpmFlow", "maximumBpmGap", value)} /></div>
          <Range label="Smoothness preference" value={draft.bpmFlow?.transitionDifficultyTolerance || 70} onChange={(value) => update("bpmFlow", "transitionDifficultyTolerance", value)} />
          <label className={styles.toggle}><input type="checkbox" checked={draft.bpmFlow?.halfTimeMatching !== false} onChange={(event) => update("bpmFlow", "halfTimeMatching", event.target.checked)} /> Allow half-time matching</label><label className={styles.toggle}><input type="checkbox" checked={draft.bpmFlow?.doubleTimeMatching !== false} onChange={(event) => update("bpmFlow", "doubleTimeMatching", event.target.checked)} /> Allow double-time matching</label><label className={styles.toggle}><input type="checkbox" checked={!draft.bpmFlow?.allowBpmJumps} onChange={(event) => update("bpmFlow", "allowBpmJumps", !event.target.checked)} /> Prefer strict, smooth transitions</label>
          {analysis?.compatibility?.coverage && <p className={styles.coverageLine}>Estimated BPM coverage: <strong>{analysis.compatibility.coverage.bpm}%</strong> · maximum requested transition: <strong>{draft.bpmFlow?.maximumBpmGap || 8} BPM</strong></p>}
        </Panel>}
        {active === "discovery" && <Panel title="Discovery and variety" description="Balance familiar music with rediscovery while limiting artist and album repetition.">
          <Range label="Familiarity" value={draft.discovery?.familiarityBalance || 50} onChange={(value) => update("discovery", "familiarityBalance", value)} left="Explore" right="Familiar" /><Range label="Deep cuts" value={draft.discovery?.deepCutPercentage || 35} onChange={(value) => update("discovery", "deepCutPercentage", value)} /><Range label="Recently added preference" value={draft.discovery?.recentlyAddedPreference || 0} onChange={(value) => update("discovery", "recentlyAddedPreference", value)} />
          <div className={styles.two}><NumberField label="Maximum tracks per artist" value={draft.variety?.maximumTracksPerArtist} onChange={(value) => update("variety", "maximumTracksPerArtist", value)} /><NumberField label="Maximum tracks per album" value={draft.variety?.maximumTracksPerAlbum} onChange={(value) => update("variety", "maximumTracksPerAlbum", value)} /></div>
          <div className={styles.two}><NumberField label="Artist spacing" value={draft.variety?.minimumArtistSpacing} onChange={(value) => update("variety", "minimumArtistSpacing", value)} /><NumberField label="Album spacing" value={draft.variety?.minimumAlbumSpacing} onChange={(value) => update("variety", "minimumAlbumSpacing", value)} /></div>
        </Panel>}
        {active === "scoring" && <Panel title="Scoring impact" description="Weights affect relative candidate ranking after required filters. The preview is explanatory, not a guarantee.">
          {Object.entries({ moodMatchWeight: "Mood match", energyMatchWeight: "Energy match", bpmCompatibilityWeight: "BPM compatibility", popularityWeight: "Popularity", discoveryWeight: "Discovery", playlistIdentityWeight: "Playlist identity", transitionQualityWeight: "Transition quality", repeatPenalty: "Repeat penalty" }).map(([key,label]) => <Range key={key} label={label} value={draft.scoring?.[key] || 0} onChange={(value) => update("scoring", key, value)} />)}
          {analysis?.scoringImpact?.conflicts?.map((finding: any) => <div className={styles.recommendation} key={finding.code}><AlertTriangle size={17} /><div><strong>{finding.title}</strong><p>{finding.message}</p><small>{finding.remediation}</small></div></div>)}
        </Panel>}
        {active === "automation" && <Panel title="Approval, regeneration, and safety" description="Editing never activates automation by itself. Unsafe recipes still require server-side permission and governance checks.">
          <div className={styles.two}><Field label="Refresh"><select value={draft.refreshPolicy?.mode || "manual"} onChange={(event) => update("refreshPolicy", "mode", event.target.value)}><option value="manual">Manual only</option><option value="scheduled">Scheduled</option></select></Field><NumberField label="Frequency in days" value={draft.refreshPolicy?.frequencyDays} onChange={(value) => update("refreshPolicy", "frequencyDays", value)} /></div>
          <Field label="Regeneration behavior"><select value={draft.refreshPolicy?.strategy || "replace_weak"} onChange={(event) => update("refreshPolicy", "strategy", event.target.value)}><option value="replace_weak">Replace weak tracks</option><option value="full_regeneration">Full regeneration</option></select></Field>
          {[['preserveLockedTracks','Preserve locked tracks'],['preserveLikedTracks','Preserve liked tracks'],['preservePlaylistLength','Preserve playlist length'],['preserveMoodCurve','Preserve mood curve'],['preserveBpmCurve','Preserve BPM curve']].map(([key,label]) => <label className={styles.toggle} key={key}><input type="checkbox" checked={draft.refreshPolicy?.[key] !== false} onChange={(event) => update("refreshPolicy", key, event.target.checked)} /> {label}</label>)}
          <label className={styles.toggle}><input type="checkbox" checked={draft.automationPolicy?.enabled === true} onChange={(event) => update("automationPolicy", "enabled", event.target.checked)} /> Offer automation after explicit approval <small>Server validation, protected-playlist checks, and local approval remain authoritative.</small></label>
        </Panel>}
        {active === "advanced" && <Panel title="Dependencies and advanced settings" description="Inspect inherited and governed dependencies, or edit the same strategy document using structured JSON.">
          <div className={styles.dependencyList}>{draft.baseRecipe ? <div><Layers3 size={17} /><span><strong>{draft.baseRecipe.name}</strong><small>Base recipe · v{draft.baseRecipe.recipeVersion}</small></span></div> : <p>No parent recipe.</p>}{(draft.governance?.dependencies || []).map((dependency: any) => <div key={`${dependency.type}-${dependency.name}`} data-error={dependency.required && dependency.status !== "AVAILABLE"}><ShieldCheck size={17} /><span><strong>{dependency.name}</strong><small>{dependency.type} · {humanStatus(dependency.status)} · {dependency.message}</small></span></div>)}</div>
          {recipeId && <div className={styles.linkRow}><Link href={`/recipes/${recipeId}`}>Inheritance, governance, snapshots, and audit</Link><Link href={`/recipes/${recipeId}/compare`}>Compare this recipe</Link></div>}
          {mode === "advanced" && <><div className={styles.rawActions}><button onClick={loadRaw}>Load structured settings</button><button onClick={applyRaw} disabled={!raw}>Apply to draft</button></div><Field label="Structured recipe settings" hint="Only strategy sections are loaded; identity, trust, approval, signatures, and audit data cannot be overwritten here."><textarea className={styles.raw} rows={20} value={raw} spellCheck={false} onChange={(event) => setRaw(event.target.value)} /></Field></>}
        </Panel>}
      </section>
      <Diagnostics analysis={analysis} state={analysisState} onSection={setActive} />
    </div>}
    <div className={styles.mobileSave}><button onClick={() => void validate()} disabled={validating}>Validate</button><button className={styles.primary} onClick={() => void save()} disabled={saving || !dirty}><Save size={16} /> Save</button></div>
  </main>;
}

function GuidedBuilder({ step, answers, libraries, onStep, onAnswers, onApply }: { step: number; answers: GuidedRecipeAnswers; libraries: LibraryOption[]; onStep: (step: number) => void; onAnswers: (patch: Partial<GuidedRecipeAnswers>) => void; onApply: () => void }) {
  const titles = ["Mix purpose", "Library and size", "Discovery and flow", "Variety and refresh", "Safety and review"];
  return <section className={styles.guided} aria-labelledby="guided-title"><header><span>Step {step + 1} of {titles.length}</span><h2 id="guided-title">{titles[step]}</h2><p>Answer in plain language. Recipe Studio translates the choices into the full recipe schema.</p></header><ol className={styles.guidedProgress} aria-label="Guided builder progress">{titles.map((title,index) => <li key={title} data-active={index === step} data-complete={index < step}><span>{index + 1}</span><small>{title}</small></li>)}</ol>
    <div className={styles.guidedBody}>
      {step === 0 && <Choice label="What kind of mix are you creating?" value={answers.mixStyle} values={[["balanced","Balanced mix"],["focus","Focus"],["workout","Workout"],["party","Party"],["chill","Chill"],["discovery","Discovery"]]} onChange={(value) => onAnswers({ mixStyle: value as any })} />}
      {step === 1 && <><Field label="Which library should it use?"><select value={answers.libraryId || ""} onChange={(event) => onAnswers({ libraryId: event.target.value || null })}><option value="">Choose a library</option>{libraries.map((library) => <option value={library.id} key={library.id}>{library.serverName} — {library.name} ({library.tracks.toLocaleString()} tracks)</option>)}</select></Field><Field label="How many tracks should it contain?" hint="Recommended: 50–150"><input type="number" min="1" max="5000" value={answers.trackCount} onChange={(event) => onAnswers({ trackCount: Number(event.target.value) })} /></Field></>}
      {step === 2 && <><Choice label="Should the mix favor familiar music or discovery?" value={answers.discoveryBalance} values={[["familiar","Mostly familiar"],["balanced","Balanced"],["exploratory","More discovery"]]} onChange={(value) => onAnswers({ discoveryBalance: value as any })} /><Choice label="How should energy change?" value={answers.energyShape} values={[["steady","Stay steady"],["rising","Rise"],["falling","Fall"],["peak","Peak in middle"],["dip","Dip in middle"]]} onChange={(value) => onAnswers({ energyShape: value as any })} /><label className={styles.toggle}><input type="checkbox" checked={answers.smoothBpm} onChange={(event) => onAnswers({ smoothBpm: event.target.checked })} /> Keep BPM transitions smooth</label></>}
      {step === 3 && <><Choice label="How much artist repetition is acceptable?" value={answers.artistRepetition} values={[["low","Very little"],["balanced","Balanced"],["relaxed","Relaxed"]]} onChange={(value) => onAnswers({ artistRepetition: value as any })} /><Choice label="How often should the playlist refresh?" value={answers.refresh} values={[["manual","Manual only"],["weekly","Weekly"],["monthly","Monthly"]]} onChange={(value) => onAnswers({ refresh: value as any })} /></>}
      {step === 4 && <><label className={styles.toggle}><input type="checkbox" checked={answers.requireApproval} onChange={(event) => onAnswers({ requireApproval: event.target.checked })} /> Require approval before automated changes</label><label className={styles.toggle}><input type="checkbox" checked={answers.household} onChange={(event) => onAnswers({ household: event.target.checked })} /> Use household collaboration</label><Choice label="What if too few candidates are available?" value={answers.insufficientCandidates} values={[["allow_fallback","Use safe fallbacks"],["reduce_size","Return fewer tracks"],["stop","Stop and explain"]]} onChange={(value) => onAnswers({ insufficientCandidates: value as any })} /><div className={styles.guidedSummary}><strong>Ready to build</strong><p>{answers.trackCount} tracks · {humanStatus(answers.discoveryBalance)} discovery · {humanStatus(answers.energyShape)} energy · {humanStatus(answers.refresh)} refresh.</p><small>You will review the generated beginner and advanced settings before saving.</small></div></>}
    </div><footer><button onClick={() => onStep(Math.max(0, step - 1))} disabled={step === 0}>Back</button>{step < titles.length - 1 ? <button className={styles.primary} onClick={() => onStep(step + 1)}>Continue <ChevronRight size={15} /></button> : <button className={styles.primary} onClick={onApply}><Wand2 size={15} /> Generate settings</button>}</footer>
  </section>;
}

function Diagnostics({ analysis, state, onSection }: { analysis: Analysis | null; state: string; onSection: (section: string) => void }) {
  return <aside className={styles.diagnostics} aria-label="Live recipe diagnostics" aria-busy={state === "loading"}><header><div><Sparkles size={18} /><span><strong>Live diagnostics</strong><small>Estimates, not generated results</small></span></div><em data-state={state}>{state}</em></header>{!analysis ? <div className={styles.analysisEmpty}>{state === "loading" ? <Loader2 className="animate-spin" /> : <AlertTriangle />}<p>{state === "loading" ? "Analyzing the current draft…" : "Live analysis is unavailable. You can continue editing and retry by changing a field."}</p></div> : <>
    <section><h3>Candidate estimate</h3><dl className={styles.metrics}><div><dt>Tracks evaluated</dt><dd>{analysis.candidateEstimate.evaluatedTracks.toLocaleString()}</dd></div><div><dt>Matching candidates</dt><dd>{analysis.candidateEstimate.matchingCandidates.toLocaleString()}</dd></div><div><dt>Unique artists</dt><dd>{analysis.candidateEstimate.uniqueArtists.toLocaleString()}</dd></div><div><dt>Capacity</dt><dd>{analysis.candidateEstimate.estimatedPlaylistCapacity.toLocaleString()}</dd></div><div><dt>Headroom</dt><dd>{analysis.candidateEstimate.headroom}×</dd></div></dl><p data-good={analysis.candidateEstimate.achievable}><strong>{analysis.candidateEstimate.achievable ? "Compatible" : "Size unlikely"}</strong> · fallback {analysis.candidateEstimate.fallbackLikely ? "likely" : "unlikely"}</p><details><summary>Estimated rule rejections</summary>{analysis.candidateEstimate.rejected?.length ? analysis.candidateEstimate.rejected.map((item: any) => <div className={styles.rejection} key={item.rule}><span>{item.rule}</span><b>−{item.estimatedTracks.toLocaleString()}</b><small>{item.explanation}</small></div>) : <p>No major estimated rejections.</p>}</details></section>
    <section><h3>Compatibility</h3><div className={styles.score}><strong>{analysis.compatibility.score}%</strong><span>{humanStatus(analysis.compatibility.status)}</span></div>{analysis.compatibility.findings.slice(0,4).map((finding: any) => <button className={styles.finding} data-severity={finding.severity} key={finding.code} onClick={() => onSection(finding.code.startsWith("bpm") || finding.code.includes("bpm") ? "bpm" : finding.code.startsWith("candidate") ? "candidates" : finding.code.includes("energy") || finding.code.includes("mood") ? "energy" : "advanced")}><AlertTriangle size={15} /><span><strong>{finding.title}</strong><small>{finding.message}</small>{finding.remediation && <em>{finding.remediation}</em>}</span></button>)}</section>
    <section><h3>Discovery preview</h3><div className={styles.discoveryBar} aria-label={`Familiar ${analysis.discoveryPreview.familiarFavorites}%, rediscovery ${analysis.discoveryPreview.rediscovery}%, new or rare ${analysis.discoveryPreview.newOrRare}%`}><i style={{ width: `${analysis.discoveryPreview.familiarFavorites}%` }} /><i style={{ width: `${analysis.discoveryPreview.rediscovery}%` }} /><i style={{ width: `${analysis.discoveryPreview.newOrRare}%` }} /></div><p>{analysis.discoveryPreview.familiarFavorites}% familiar · {analysis.discoveryPreview.rediscovery}% rediscovery · {analysis.discoveryPreview.newOrRare}% new or rare</p><small>{analysis.discoveryPreview.estimatedArtists} artists · {analysis.discoveryPreview.estimatedAlbums} albums · variety {analysis.discoveryPreview.varietyScore}%</small></section>
    <section><h3>Scoring influence</h3>{analysis.scoringImpact.activeFactors.slice(0,5).map((factor: any) => <div className={styles.factor} key={factor.key}><span>{factor.label}</span><i><em style={{ width: `${factor.weight}%` }} /></i><b>{factor.influence === "negative" ? "−" : "+"}{factor.weight}</b></div>)}</section>
  </>}</aside>;
}

function CurveGraphic({ points }: { points: CurvePoint[] }) { const ordered = [...points].sort((left,right) => left.position - right.position); const path = ordered.map((point,index) => `${index ? "L" : "M"} ${point.position * 3} ${100 - point.value}`).join(" "); return <svg className={styles.curve} viewBox="0 0 300 110" role="img" aria-label={`Energy curve with ${points.length} control points`}><title>Requested normalized energy progression</title><line x1="0" y1="100" x2="300" y2="100"/><line x1="0" y1="0" x2="0" y2="100"/><path d={path}/>{ordered.map((point,index) => <circle key={`${point.position}-${index}`} cx={point.position * 3} cy={100 - point.value} r="5"><title>Point {index + 1}: position {point.position}%, energy {point.value}</title></circle>)}</svg>; }
function Panel({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <div className={styles.panel}><header><h2>{title}</h2><p>{description}</p></header><div className={styles.panelBody}>{children}</div></div>; }
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <label className={styles.field}><span>{label}{hint && <small>{hint}</small>}</span>{children}</label>; }
function NumberField({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) { return <Field label={label}><input type="number" value={value ?? ""} onChange={(event) => onChange(inputNumber(event.target.value))} /></Field>; }
function Range({ label, value, onChange, left="Low", right="High" }: { label: string; value: number; onChange: (value: number) => void; left?: string; right?: string }) { return <label className={styles.range}><span><strong>{label}</strong><b>{value}%</b></span><input type="range" min="0" max="100" value={value} onChange={(event) => onChange(Number(event.target.value))}/><small><span>{left}</span><span>{right}</span></small></label>; }
function Choice({ label, value, values, onChange }: { label: string; value: string; values: string[][]; onChange: (value: string) => void }) { return <fieldset className={styles.choice}><legend>{label}</legend><div>{values.map(([id,name]) => <label key={id} data-selected={value === id}><input type="radio" name={label} value={id} checked={value === id} onChange={() => onChange(id)} /><span>{name}</span></label>)}</div></fieldset>; }
