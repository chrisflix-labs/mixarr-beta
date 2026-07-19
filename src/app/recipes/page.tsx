"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import axios from "axios";
import { AlertCircle, Archive, BookMarked, CheckCircle2, ChevronRight, Copy, Download, Edit3, FileJson, History, Info, Loader2, Play, RefreshCw, ShieldCheck, Trash2, Upload, Wand2, X } from "lucide-react";
import styles from "./recipes.module.css";

type PlaylistRecipe = {
  id: string; name: string; description?: string | null; filterSummary: string; createdAt: string; updatedAt: string;
  lastUsedAt?: string | null; lastExportedAt?: string | null; useCount: number; category: string; enabled: boolean;
  recipeVersion: number; schemaVersion: number; playlistCount: number; validation: { valid: boolean; errors: unknown[]; warnings: unknown[] };
  automationPolicy?: { enabled: boolean }; artworkUrl?: string | null; importedAt?: string | null;
};

type ConflictAction = "import" | "rename" | "replace" | "skip" | "use_existing";
type PreviewRecipe = {
  index: number; name: string; description: string | null; category: string; artwork: { included: boolean; reference: string | null };
  sourceFormatVersion: number; sourceRecipeVersion: number; exportingApplicationVersion: string | null; checksumStatus: string;
  sensitiveDataScan: { safe: boolean; findingCount: number; categories: { category: string; count: number }[] };
  compatibleSettings: number; compatibility: Array<{ path: string; classification: string; message: string }>; adaptations: Array<{ path: string; sourceValue: unknown; proposedValue: unknown; reason: string; impact: string; required: boolean }>;
  unsupported: Array<{ path: string; message: string }>; ignored: Array<{ path: string; message: string }>;
  validationErrors: Array<{ path: string; code: string; message: string }>; validationWarnings: Array<{ path: string; code: string; message: string }>;
  migrationSteps: string[]; conflicts: Array<{ type: string; existingRecipeId?: string; existingRecipeName?: string; message: string; allowedActions: ConflictAction[]; recommendedAction: ConflictAction }>;
  proposedName: string; recommendedAction: ConflictAction; summary: Record<string, string>; ready: boolean;
};
type ImportPreview = {
  format: string; formatVersion: number; exportingApplicationVersion: string | null; bundleChecksumStatus: string | null; totalRecipes: number;
  ready: number; requireAdaptation: number; haveConflicts: number; invalid: number; duplicateContentMatches: number; artworkCount: number;
  totalImportSize: number; securityStatus: string; recipes: PreviewRecipe[];
};
type Decision = { selected: boolean; action: ConflictAction; name: string };
type ImportResult = { historyId: string; status: string; counts: Record<string, number>; results: Array<{ index: number; name: string; action: string; error?: string }> };
type HistoryData = { imports: any[]; exports: any[] };

const wizardLabels = ["Select file", "Validate", "Preview", "Resolve", "Confirm", "Results"];

function formatDate(value?: string | null) { return value ? new Date(value).toLocaleString() : "Never"; }
function formatBytes(value: number) { return value < 1024 * 1024 ? `${Math.ceil(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }
function filenameFromDisposition(header?: string, fallback = "mixarr-recipes.json") { return header?.match(/filename="?([^";]+)"?/i)?.[1] || fallback; }
function downloadResponse(data: BlobPart, filename: string, mime = "application/json") {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime }); const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}

export default function RecipesPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [recipes, setRecipes] = useState<PlaylistRecipe[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [search, setSearch] = useState(""); const [category, setCategory] = useState("all"); const [status, setStatus] = useState("all"); const [sort, setSort] = useState("updated");
  const [selected, setSelected] = useState<Set<string>>(new Set()); const [busyId, setBusyId] = useState(""); const [exporting, setExporting] = useState(false);
  const [exportArchive, setExportArchive] = useState(false); const [includeArtwork, setIncludeArtwork] = useState(false); const [notice, setNotice] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false); const [wizardStep, setWizardStep] = useState(1); const [dragging, setDragging] = useState(false);
  const [importFileName, setImportFileName] = useState(""); const [stageId, setStageId] = useState(""); const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({}); const [importMode, setImportMode] = useState<"atomic" | "independent">("atomic");
  const [importBusy, setImportBusy] = useState(false); const [importError, setImportError] = useState(""); const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false); const [history, setHistory] = useState<HistoryData | null>(null); const [historyBusy, setHistoryBusy] = useState(false);

  const displayed = useMemo(() => recipes.filter((recipe) => !search || `${recipe.name} ${recipe.description || ""}`.toLowerCase().includes(search.toLowerCase()))
    .filter((recipe) => category === "all" || recipe.category === category).filter((recipe) => status === "all" || recipe.enabled === (status === "enabled"))
    .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "used" ? new Date(b.lastUsedAt || 0).getTime() - new Date(a.lastUsedAt || 0).getTime() : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), [recipes, search, category, status, sort]);

  const fetchRecipes = async () => { setLoading(true); setError(""); try { const response = await axios.get("/api/playlist-recipes"); setRecipes(response.data.recipes || []); } catch { setError("Unable to load Mix Recipes."); } finally { setLoading(false); } };
  useEffect(() => { fetchRecipes(); }, []);

  const toggleSelected = (id: string) => setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const selectVisible = () => setSelected((current) => displayed.every((recipe) => current.has(recipe.id)) ? new Set() : new Set(displayed.map((recipe) => recipe.id)));

  const exportRecipes = async (ids: string[], options: { archive?: boolean; includeArtwork?: boolean; excludeInvalid?: boolean } = {}) => {
    setExporting(true); setNotice("");
    try {
      const response = await axios.post("/api/playlist-recipes/export", { recipeIds: ids, ...options }, { responseType: "blob" });
      downloadResponse(response.data, filenameFromDisposition(response.headers["content-disposition"]), options.archive ? "application/zip" : "application/json");
      const summary = response.headers["x-mixarr-export-summary"] ? JSON.parse(decodeURIComponent(response.headers["x-mixarr-export-summary"])) : { recipeCount: ids.length, formatVersion: 1, artworkCount: 0, warnings: 0 };
      const names = recipes.filter((recipe) => ids.includes(recipe.id)).map((recipe) => recipe.name);
      setNotice(`Exported ${summary.recipeCount === 1 ? `“${names[0]}”` : `${summary.recipeCount} recipes`} in format v${summary.formatVersion}. ${summary.artworkCount} artwork file${summary.artworkCount === 1 ? "" : "s"} included; ${summary.warnings} sanitization warning${summary.warnings === 1 ? "" : "s"}.`);
    } catch (caught: any) {
      let payload: any = null; try { payload = JSON.parse(await caught.response?.data?.text()); } catch { /* response was not JSON */ }
      const message = payload?.error || "Recipe export failed.";
      if (!options.excludeInvalid && ids.length > 1 && /invalid/i.test(message) && window.confirm(`${message}\n\nExclude invalid recipes and continue?`)) await exportRecipes(ids, { ...options, excludeInvalid: true });
      else setError(message);
    } finally { setExporting(false); }
  };

  const resetWizard = async (cancel = true) => {
    if (cancel && stageId) await axios.delete(`/api/playlist-recipes/import/${stageId}`).catch(() => undefined);
    setWizardStep(1); setImportFileName(""); setStageId(""); setPreview(null); setDecisions({}); setImportError(""); setImportResult(null); setImportMode("atomic");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const closeWizard = async () => { await resetWizard(true); setWizardOpen(false); };

  const stageFile = async (file: File) => {
    setImportError(""); setImportResult(null); setImportFileName(file.name); setWizardStep(2); setImportBusy(true);
    const lower = file.name.toLowerCase(); const archive = lower.endsWith(".zip");
    if (!(lower.endsWith(".json") || archive)) { setImportError("Choose a .mixarr-recipe.json, .mixarr-bundle.json, .mixarr-recipe.zip, or .mixarr-bundle.zip file."); setWizardStep(1); setImportBusy(false); return; }
    if (file.size > (archive ? 20 : 5) * 1024 * 1024) { setImportError(`This file exceeds the ${archive ? 20 : 5} MB limit.`); setWizardStep(1); setImportBusy(false); return; }
    try {
      let content: string; let encoding: "utf8" | "base64" = "utf8";
      if (archive) { const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ""; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...Array.from(bytes.subarray(offset, offset + 0x8000))); content = btoa(binary); encoding = "base64"; }
      else content = await file.text();
      const response = await axios.post("/api/playlist-recipes/import/preview", { filename: file.name, content, encoding });
      setStageId(response.data.stageId); setPreview(response.data.preview);
      setDecisions(Object.fromEntries(response.data.preview.recipes.map((recipe: PreviewRecipe) => [recipe.index, { selected: recipe.ready, action: recipe.recommendedAction, name: recipe.proposedName }])));
      setWizardStep(3);
    } catch (caught: any) { setImportError(caught.response?.data?.error || "Mixarr could not validate this import."); setWizardStep(1); } finally { setImportBusy(false); }
  };
  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) stageFile(file); };
  const onDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files?.[0]; if (file) stageFile(file); };
  const updateDecision = (index: number, patch: Partial<Decision>) => setDecisions((current) => ({ ...current, [index]: { ...current[index], ...patch } }));
  const bulkDecision = (action: ConflictAction) => setDecisions((current) => Object.fromEntries(Object.entries(current).map(([index, decision]) => {
    const recipe = preview?.recipes.find((item) => item.index === Number(index));
    const allowed = recipe?.conflicts.some((conflict) => conflict.allowedActions.includes(action));
    return [index, allowed ? { ...decision, action } : decision];
  })));

  const confirmImport = async () => {
    if (!stageId || !preview) return; setImportBusy(true); setImportError("");
    try {
      const response = await axios.post("/api/playlist-recipes/import", { stageId, mode: importMode, decisions: Object.entries(decisions).map(([index, decision]) => ({ index: Number(index), ...decision })) });
      setImportResult(response.data); setWizardStep(6); await fetchRecipes();
    } catch (caught: any) { setImportError(caught.response?.data?.error || "The import transaction failed."); } finally { setImportBusy(false); }
  };

  const duplicateRecipe = async (recipe: PlaylistRecipe) => { setBusyId(recipe.id); try { const response = await axios.post(`/api/playlist-recipes/${recipe.id}/duplicate`); router.push(`/recipes/${response.data.recipe.id}`); } catch (caught: any) { setError(caught.response?.data?.error || "Recipe duplication failed."); } finally { setBusyId(""); } };
  const deleteRecipe = async (recipe: PlaylistRecipe) => { if (!window.confirm(`Delete recipe “${recipe.name}”? ${recipe.playlistCount} generated playlist(s) will be retained.`)) return; try { await axios.delete(`/api/playlist-recipes/${recipe.id}`); setRecipes((current) => current.filter((item) => item.id !== recipe.id)); } catch { setError("Recipe deletion failed."); } };

  const loadHistory = async () => { setHistoryOpen(true); setHistoryBusy(true); try { setHistory((await axios.get("/api/playlist-recipes/history")).data); } catch (caught: any) { setError(caught.response?.data?.error || "Recipe history could not be loaded."); } finally { setHistoryBusy(false); } };
  const clearHistory = async () => { if (!window.confirm("Clear your recipe import and export history? Recipe files and saved recipes are not deleted.")) return; try { await axios.delete("/api/playlist-recipes/history"); setHistory({ imports: [], exports: [] }); } catch (caught: any) { setError(caught.response?.data?.error || "Administrator permission is required to clear history."); } };
  const downloadDiagnostic = async (id: string) => { try { const response = await axios.get(`/api/playlist-recipes/history/imports/${id}/diagnostic`, { responseType: "blob" }); downloadResponse(response.data, filenameFromDisposition(response.headers["content-disposition"], "mixarr-import-diagnostic.json")); } catch { setError("The sanitized diagnostic is unavailable."); } };

  return <main className={styles.page}>
    <header className={styles.header}><div><span className={styles.kicker}><BookMarked size={14} /> Mix Recipe Library</span><h2>Mix Recipes</h2><p>Portable Smart Mix strategies—separate from Plex playlists, tracks, and listening history.</p></div><div className={styles.headerActions}>
      <button className={styles.secondaryButton} onClick={() => { resetWizard(false); setWizardOpen(true); }}><Upload size={16} /> Import Recipe</button>
      <button className={styles.secondaryButton} onClick={loadHistory}><History size={16} /> Transfer History</button>
      <Link href="/smart-builder" className={styles.primaryButton}><Wand2 size={16} /> Create Recipe</Link>
    </div></header>

    {notice && <div className={styles.importSuccess}><CheckCircle2 size={17} /><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button></div>}
    {error && <div className={styles.importError}><AlertCircle size={17} /><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss"><X size={15} /></button></div>}

    <section className={styles.transferHelp}><ShieldCheck size={20} /><div><strong>Private by design</strong><p>Exports use an allowlisted format with SHA-256 integrity checks. Plex credentials and IDs, filesystem paths, generated tracks, listening history, feedback, and local automation destinations are excluded.</p></div><details><summary>Supported formats and limits</summary><p>Single recipe JSON and bundles: 5 MB. Optional artwork archives: 20 MB compressed, 50 MB expanded. PNG, JPEG, and WebP artwork only.</p></details></section>

    <section className={styles.filters} aria-label="Recipe filters"><input aria-label="Search recipes" placeholder="Search recipes" value={search} onChange={(event) => setSearch(event.target.value)} /><select aria-label="Category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{Array.from(new Set(recipes.map((recipe) => recipe.category))).sort().map((value) => <option key={value}>{value}</option>)}</select><select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Enabled and disabled</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select><select aria-label="Sort recipes" value={sort} onChange={(event) => setSort(event.target.value)}><option value="updated">Recently updated</option><option value="used">Recently used</option><option value="name">Name</option></select></section>

    {recipes.length > 0 && <section className={styles.bulkBar}><label><input type="checkbox" checked={displayed.length > 0 && displayed.every((recipe) => selected.has(recipe.id))} onChange={selectVisible} /> Select all visible</label><span>{selected.size} selected</span><label><input type="checkbox" checked={exportArchive} onChange={(event) => setExportArchive(event.target.checked)} /> Archive (.zip)</label><label><input type="checkbox" checked={includeArtwork} disabled={!exportArchive} onChange={(event) => setIncludeArtwork(event.target.checked)} /> Include artwork</label><button className={styles.secondaryButton} disabled={!selected.size || exporting} onClick={() => exportRecipes(Array.from(selected), { archive: exportArchive, includeArtwork })}>{exporting ? <Loader2 size={15} className="animate-spin" /> : exportArchive ? <Archive size={15} /> : <Download size={15} />} Export selected</button></section>}

    {loading ? <div className={styles.statePanel}>Loading Mix Recipes…</div> : recipes.length === 0 ? <section className={styles.emptyState}><BookMarked size={28} /><h3>No Mix Recipes yet</h3><p>Create one or import a sanitized recipe file. Importing never creates a Plex playlist automatically.</p><Link href="/smart-builder" className={styles.primaryButton}><Wand2 size={16} /> Create Recipe</Link></section> : <section className={styles.recipeGrid}>{displayed.map((recipe) => <article key={recipe.id} className={styles.recipeCard}>
      <label className={styles.cardSelect}><input type="checkbox" checked={selected.has(recipe.id)} onChange={() => toggleSelected(recipe.id)} /><span>Select {recipe.name}</span></label>
      <div className={styles.artwork} style={recipe.artworkUrl ? { backgroundImage: `url("${recipe.artworkUrl.replace(/["\\()]/g, "")}")` } : undefined}><span>{recipe.artworkUrl ? "" : recipe.category.slice(0, 1).toUpperCase()}</span></div>
      <div className={styles.cardTop}><div><h3>{recipe.name}</h3>{recipe.description && <p>{recipe.description}</p>}</div><span data-valid={recipe.validation.valid}>{recipe.validation.valid ? "Valid" : "Needs attention"}</span></div>
      <dl className={styles.metaGrid}><div><dt>Recipe</dt><dd>{recipe.category} · v{recipe.recipeVersion}</dd></div><div><dt>Playlists</dt><dd>{recipe.playlistCount}</dd></div><div><dt>Updated</dt><dd>{formatDate(recipe.updatedAt)}</dd></div><div><dt>Last used</dt><dd>{formatDate(recipe.lastUsedAt)}</dd></div></dl>
      <p className={styles.summary}>{recipe.filterSummary || "No filters saved."}</p><p className={styles.automationSummary}>{recipe.importedAt ? "Imported recipe" : "Local recipe"} · {recipe.automationPolicy?.enabled ? "Automation requires confirmation" : "Automation disabled"}</p>
      <div className={styles.actions}><Link href={`/builder?recipeId=${recipe.id}&preview=1`} className={styles.secondaryButton}><Play size={15} /> Create playlist</Link><Link href={`/recipes/${recipe.id}`} className={styles.secondaryButton}><Edit3 size={15} /> Details</Link><button className={styles.secondaryButton} onClick={() => duplicateRecipe(recipe)} disabled={busyId === recipe.id}>{busyId === recipe.id ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />} Duplicate</button><button className={styles.secondaryButton} onClick={() => exportRecipes([recipe.id])} disabled={exporting}><Download size={15} /> Export JSON</button><button className={styles.dangerButton} onClick={() => deleteRecipe(recipe)}><Trash2 size={15} /> Delete</button></div>
    </article>)}</section>}

    {wizardOpen && <div className={styles.wizardBackdrop} role="dialog" aria-modal="true" aria-labelledby="import-title"><section className={styles.wizard}>
      <header className={styles.wizardHeader}><div><span className={styles.kicker}><Upload size={14} /> Secure import</span><h3 id="import-title">Import Mix Recipes</h3></div><button className={styles.iconButton} onClick={closeWizard} aria-label="Close import wizard"><X /></button></header>
      <ol className={styles.wizardSteps}>{wizardLabels.map((label, index) => <li key={label} data-active={wizardStep === index + 1} data-complete={wizardStep > index + 1}><span>{index + 1}</span>{label}</li>)}</ol>
      <div className={styles.wizardBody}>
        {wizardStep === 1 && <><div className={styles.dropZone} data-dragging={dragging} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={() => fileInputRef.current?.click()}><Upload size={34} /><h4>Drop a recipe file here</h4><p>or choose a JSON recipe, JSON bundle, or artwork archive</p><button className={styles.primaryButton}>Choose file</button><input ref={fileInputRef} type="file" hidden accept=".json,.zip,application/json,application/zip" onChange={onFileChange} /></div><div className={styles.limitGrid}><span><FileJson size={17} /> JSON up to 5 MB</span><span><Archive size={17} /> Archive up to 20 MB</span><span><ShieldCheck size={17} /> Preview required</span></div></>}
        {wizardStep === 2 && <div className={styles.validationProgress}><Loader2 className="animate-spin" size={34} /><h4>Validating {importFileName}</h4>{["Reading file", "Detecting format", "Validating checksums", "Scanning for private data", "Checking compatibility", "Detecting conflicts"].map((item) => <p key={item}><CheckCircle2 size={15} /> {item}</p>)}</div>}
        {importError && <div className={styles.importError}><AlertCircle size={16} /> {importError}</div>}
        {wizardStep === 3 && preview && <><div className={styles.securityBanner} data-safe={preview.recipes.every((recipe) => recipe.sensitiveDataScan.safe)}><ShieldCheck size={20} /><div><strong>{preview.securityStatus}</strong><p>{preview.format} v{preview.formatVersion} · {formatBytes(preview.totalImportSize)} · exported by {preview.exportingApplicationVersion ? `Mixarr ${preview.exportingApplicationVersion}` : "an older Mixarr version"}</p></div></div><div className={styles.importStats}><span><b>{preview.totalRecipes}</b> total</span><span><b>{preview.ready}</b> ready</span><span><b>{preview.requireAdaptation}</b> adapt</span><span><b>{preview.haveConflicts}</b> conflicts</span><span><b>{preview.invalid}</b> invalid</span><span><b>{preview.artworkCount}</b> artwork</span></div><div className={styles.previewList}>{preview.recipes.map((recipe) => <RecipePreviewCard key={recipe.index} recipe={recipe} technical />)}</div></>}
        {wizardStep === 4 && preview && <><div className={styles.bulkChoices}><span>Bulk choices:</span><button onClick={() => bulkDecision("rename")}>Rename conflicts</button><button onClick={() => bulkDecision("skip")}>Skip all</button><button onClick={() => bulkDecision("use_existing")}>Use identical existing</button></div><div className={styles.previewList}>{preview.recipes.map((recipe) => <article key={recipe.index} className={styles.resolveCard}><label><input type="checkbox" checked={decisions[recipe.index]?.selected ?? false} disabled={!recipe.ready} onChange={(event) => updateDecision(recipe.index, { selected: event.target.checked })} /><strong>{recipe.name}</strong></label>{recipe.conflicts.length > 0 && <select value={decisions[recipe.index]?.action || recipe.recommendedAction} onChange={(event) => updateDecision(recipe.index, { action: event.target.value as ConflictAction })}>{Array.from(new Set(recipe.conflicts.flatMap((conflict) => conflict.allowedActions))).map((action) => <option value={action} key={action}>{action.replace("_", " ")}</option>)}</select>}{decisions[recipe.index]?.action === "rename" && <input value={decisions[recipe.index]?.name || recipe.proposedName} maxLength={120} onChange={(event) => updateDecision(recipe.index, { name: event.target.value })} aria-label={`New name for ${recipe.name}`} />}{recipe.adaptations.map((adaptation) => <p key={adaptation.path} className={styles.warningText}><b>{adaptation.required ? "Required" : "Optional"}:</b> {adaptation.reason} {adaptation.impact}</p>)}{recipe.unsupported.map((item) => <p key={item.path} className={styles.errorText}>{item.message}</p>)}</article>)}</div></>}
        {wizardStep === 5 && preview && <><div className={styles.confirmSummary}><h4>Ready to import</h4><dl><div><dt>Import</dt><dd>{Object.values(decisions).filter((item) => item.selected && ["import", "rename"].includes(item.action)).length}</dd></div><div><dt>Replace</dt><dd>{Object.values(decisions).filter((item) => item.selected && item.action === "replace").length}</dd></div><div><dt>Use existing</dt><dd>{Object.values(decisions).filter((item) => item.selected && item.action === "use_existing").length}</dd></div><div><dt>Skip</dt><dd>{Object.values(decisions).filter((item) => !item.selected || item.action === "skip").length}</dd></div><div><dt>Adaptations</dt><dd>{preview.recipes.filter((recipe) => decisions[recipe.index]?.selected).reduce((total, recipe) => total + recipe.adaptations.length, 0)}</dd></div></dl></div><fieldset className={styles.modeChoice}><legend>Bundle transaction mode</legend><label><input type="radio" checked={importMode === "atomic"} onChange={() => setImportMode("atomic")} /> <span><b>Atomic import (recommended)</b><small>Roll back every selected recipe if any import fails.</small></span></label><label><input type="radio" checked={importMode === "independent"} onChange={() => setImportMode("independent")} /> <span><b>Independent import</b><small>Keep successful recipes and report failures individually.</small></span></label></fieldset><p className={styles.confirmNotice}><Info size={16} /> Importing saves recipes only. It does not create playlists or activate automation.</p></>}
        {wizardStep === 6 && importResult && <><div className={styles.resultHero}><CheckCircle2 size={38} /><h4>Import {importResult.status.toLowerCase()}</h4><p>{importResult.counts.imported || 0} imported · {importResult.counts.renamed || 0} renamed · {importResult.counts.replaced || 0} replaced · {importResult.counts.alreadyPresent || 0} already present · {importResult.counts.skipped || 0} skipped · {importResult.counts.failed || 0} failed</p></div><div className={styles.resultList}>{importResult.results.map((item) => <p key={`${item.index}-${item.action}`} data-failed={item.action === "failed"}><span>{item.name}</span><b>{item.action.replace("_", " ")}</b>{item.error && <small>{item.error}</small>}</p>)}</div><div className={styles.resultActions}><button className={styles.secondaryButton} onClick={() => downloadDiagnostic(importResult.historyId)}><Download size={15} /> Download sanitized diagnostics</button><button className={styles.secondaryButton} onClick={() => { closeWizard(); loadHistory(); }}><History size={15} /> View history</button></div></>}
      </div>
      <footer className={styles.wizardFooter}>{wizardStep > 1 && wizardStep < 6 && <button className={styles.secondaryButton} onClick={() => setWizardStep((step) => Math.max(1, step - 1))} disabled={importBusy}>Back</button>}<span />{wizardStep === 3 && <button className={styles.primaryButton} onClick={() => setWizardStep(4)}>Resolve changes <ChevronRight size={16} /></button>}{wizardStep === 4 && <button className={styles.primaryButton} onClick={() => setWizardStep(5)}>Review import <ChevronRight size={16} /></button>}{wizardStep === 5 && <button className={styles.primaryButton} onClick={confirmImport} disabled={importBusy || !Object.values(decisions).some((item) => item.selected && item.action !== "skip")}>{importBusy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Confirm import</button>}{wizardStep === 6 && <button className={styles.primaryButton} onClick={closeWizard}>Done</button>}</footer>
    </section></div>}

    {historyOpen && <div className={styles.wizardBackdrop} role="dialog" aria-modal="true" aria-labelledby="history-title"><section className={`${styles.wizard} ${styles.historyDialog}`}><header className={styles.wizardHeader}><div><span className={styles.kicker}><History size={14} /> Audit trail</span><h3 id="history-title">Recipe Transfer History</h3></div><button className={styles.iconButton} onClick={() => setHistoryOpen(false)} aria-label="Close history"><X /></button></header><div className={styles.wizardBody}>{historyBusy ? <div className={styles.statePanel}>Loading history…</div> : <><div className={styles.historyHeader}><p>Only sanitized summaries are retained; uploaded and exported files are not stored permanently.</p><button className={styles.dangerButton} onClick={clearHistory}>Clear history</button></div><h4>Imports</h4><div className={styles.historyList}>{history?.imports.length ? history.imports.map((item) => <article key={item.id}><div><strong>{item.originalFilename}</strong><small>{formatDate(item.startedAt)} · {item.importMode.toLowerCase()}</small></div><span data-status={item.status}>{item.status}</span><p>{item.importedCount} imported · {item.adaptedCount} adapted · {item.replacedCount} replaced · {item.skippedCount} skipped · {item.failedCount} failed</p><button onClick={() => downloadDiagnostic(item.id)}><Download size={14} /> Sanitized diagnostics</button></article>) : <p className={styles.emptyHistory}>No recipe imports recorded.</p>}</div><h4>Exports</h4><div className={styles.historyList}>{history?.exports.length ? history.exports.map((item) => <article key={item.id}><div><strong>{item.exportType.replaceAll("_", " ").toLowerCase()}</strong><small>{formatDate(item.createdAt)} · format v{item.formatVersion}</small></div><span data-status={item.status}>{item.status}</span><p>{item.recipeCount} recipe{item.recipeCount === 1 ? "" : "s"} · artwork {item.includedArtwork ? "included" : "not included"} · sanitization {item.sanitizationResult.toLowerCase()}</p></article>) : <p className={styles.emptyHistory}>No recipe exports recorded.</p>}</div></>}</div></section></div>}
  </main>;
}

function RecipePreviewCard({ recipe, technical }: { recipe: PreviewRecipe; technical?: boolean }) {
  return <article className={styles.previewRecipe} data-invalid={!recipe.ready}><header><div><h4>{recipe.name}</h4><p>{recipe.description || "No description provided."}</p></div><span>{recipe.ready ? recipe.adaptations.length ? "Adaptation required" : recipe.conflicts.length ? "Conflict" : "Ready" : "Blocked"}</span></header><dl className={styles.recipeSummary}>{Object.entries(recipe.summary).filter(([key]) => key !== "title").map(([key, value]) => <div key={key}><dt>{key.replace(/([A-Z])/g, " $1")}</dt><dd>{value}</dd></div>)}</dl><div className={styles.previewBadges}><span data-ok={recipe.checksumStatus === "valid"}>Checksum: {recipe.checksumStatus}</span><span data-ok={recipe.sensitiveDataScan.safe}>Security: {recipe.sensitiveDataScan.safe ? "passed" : "blocked"}</span><span>{recipe.compatibleSettings} compatible</span><span>{recipe.adaptations.length} adaptations</span><span>{recipe.unsupported.length} unsupported</span></div>{recipe.conflicts.map((conflict) => <p className={styles.warningText} key={`${conflict.type}-${conflict.message}`}>{conflict.message}</p>)}{recipe.validationErrors.map((item) => <p className={styles.errorText} key={`${item.path}-${item.code}`}>{item.message}</p>)}{technical && <details><summary>Technical details</summary><p>Recipe schema v{recipe.sourceRecipeVersion}; export format v{recipe.sourceFormatVersion}; exporting Mixarr {recipe.exportingApplicationVersion || "unknown"}.</p>{recipe.migrationSteps.map((step) => <p key={step}>{step}</p>)}{recipe.compatibility.filter((item) => item.classification !== "compatible").map((item) => <p key={`${item.path}-${item.message}`}>{item.classification}: {item.path}: {item.message}</p>)}{recipe.validationWarnings.map((item) => <p key={`${item.path}-${item.code}`}>{item.path}: {item.message}</p>)}{recipe.adaptations.map((item) => <p key={item.path}>{item.path}: {item.reason} Proposed: {String(item.proposedValue)}</p>)}{recipe.unsupported.map((item) => <p key={item.path}>{item.path}: {item.message}</p>)}</details>}</article>;
}
