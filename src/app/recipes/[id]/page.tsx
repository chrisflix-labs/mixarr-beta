"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import axios from "axios";
import { AlertCircle, ArrowDown, ArrowLeft, CheckCircle2, Copy, Download, Edit3, Flag, GitBranch, GitCompareArrows, Layers3, Loader2, LockKeyhole, Play, RefreshCw, RotateCcw, Save, Share2, ShieldAlert, Sparkles, Trash2, Wand2, X } from "lucide-react";
import styles from "./recipe-detail.module.css";

const categories = ["Driving", "Workout", "Party", "Focus", "Chill", "Relaxation", "Sleep", "Discovery", "Deep Cuts", "Recently Added", "Forgotten Favorites", "Decade Mixes", "Seasonal Mixes", "Genre Journeys", "Artist Radio", "Album Exploration", "Mood Progressions", "Mood", "Decade", "Genre", "Artist", "Seasonal", "Custom"];
const sections = ["Recipe Foundation", "Overview", "Mood and Energy", "BPM Flow", "Discovery", "Scoring", "Artist and Album Variety", "Playlist Identity", "Refresh and Automation", "Effective Configuration", "Import Mapping", "Governance", "Validation", "Generated Playlists"];

type Message = { path: string; code: string; message: string };
type Recipe = Record<string, any> & { id: string; name: string; slug: string; validation: { valid: boolean; errors: Message[]; warnings: Message[] } };
type LibraryOption = { id: string; serverId: string; label: string; tracks: number };

function numberOrNull(value: string) {
  return value === "" ? null : Number(value);
}

function listValue(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function humanSummary(recipe: Recipe) {
  const moods = recipe.targets?.selectedMoods?.join(", ") || "flexible moods";
  const bpm = recipe.bpmFlow?.minimumBpm || recipe.bpmFlow?.maximumBpm
    ? `${recipe.bpmFlow.minimumBpm || "any"}–${recipe.bpmFlow.maximumBpm || "any"} BPM`
    : "a flexible tempo range";
  const refresh = recipe.refreshPolicy?.mode === "scheduled" ? ` Refreshes every ${recipe.refreshPolicy.frequencyDays} days.` : " Refreshes manually.";
  return `${recipe.name} targets ${moods} with ${bpm}, ${recipe.discovery?.level || "medium"} discovery, and no more than ${recipe.variety?.maximumTracksPerArtist || 3} tracks per artist.${refresh}`;
}

export default function RecipeDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [draft, setDraft] = useState<Recipe | null>(null);
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [libraries, setLibraries] = useState<LibraryOption[]>([]);
  const [activeSection, setActiveSection] = useState(sections[0]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [playlistName, setPlaylistName] = useState("");
  const [libraryId, setLibraryId] = useState("");
  const [confirmAutomation, setConfirmAutomation] = useState(false);
  const [resolution, setResolution] = useState<any>(null);
  const [recipeOptions, setRecipeOptions] = useState<any[]>([]);
  const [presetOptions, setPresetOptions] = useState<any[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<any[]>([]);
  const [showClone, setShowClone] = useState(false);
  const [sourceDetails, setSourceDetails] = useState<any>(null);
  const [auditEvents, setAuditEvents] = useState<any[]>([]);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [migrationPlan, setMigrationPlan] = useState<any>(null);
  const [restorePlan, setRestorePlan] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      axios.get(`/api/playlist-recipes/${params.id}`),
      axios.get(`/api/playlist-recipes/${params.id}/playlists`),
      axios.get("/api/plex/servers"), axios.get("/api/playlist-recipes?pageSize=100"), axios.get("/api/recipe-presets"), axios.get("/api/recipe-categories"), axios.get(`/api/playlist-recipes/${params.id}/effective-configuration`),
    ]).then(([recipeResponse, playlistResponse, serverResponse, recipesResponse, presetsResponse, categoriesResponse, effectiveResponse]) => {
      if (cancelled) return;
      const loaded = recipeResponse.data.recipe as Recipe;
      setRecipe(loaded); setDraft(structuredClone(loaded)); setPlaylistName(loaded.name);
      if (loaded.sourceRecipeId) axios.get(`/api/recipes/library/${encodeURIComponent(loaded.sourceRecipeId)}`).then((response) => setSourceDetails(response.data.recipe)).catch(() => setSourceDetails(null));
      setPlaylists(playlistResponse.data.playlists || []);
      const options = (serverResponse.data.servers || []).flatMap((server: any) => (server.libraries || []).filter((library: any) => library.type === "artist" || !library.type).map((library: any) => ({ id: library.id, serverId: server.id, label: `${server.name} — ${library.name}`, tracks: library._count?.tracks || 0 })));
      setLibraries(options);
      setLibraryId(loaded.filters?.libraryId || options[0]?.id || "");
      setRecipeOptions(recipesResponse.data.recipes || []); setPresetOptions(presetsResponse.data.presets || []); setCategoryOptions(categoriesResponse.data.categories || []); setResolution(effectiveResponse.data);
      axios.get(`/api/recipes/audit?recipeId=${encodeURIComponent(params.id)}`).then((response) => setAuditEvents(response.data.events || [])).catch(() => setAuditEvents([]));
      axios.get(`/api/recipes/${encodeURIComponent(params.id)}/snapshots`).then((response) => setSnapshots(response.data.snapshots || [])).catch(() => setSnapshots([]));
    }).catch((caught) => setError(caught.response?.data?.error || "Unable to load this recipe.")).finally(() => setLoading(false));
    return () => { cancelled = true; };
  }, [params.id]);

  const dirty = useMemo(() => recipe && draft && JSON.stringify(recipe) !== JSON.stringify(draft), [recipe, draft]);
  function update(section: string, key: string, value: unknown) {
    setDraft((current) => current ? { ...current, [section]: { ...current[section], [key]: value } } : current);
  }
  function updateRoot(key: string, value: unknown) { setDraft((current) => current ? { ...current, [key]: value } : current); }

  async function save() {
    if (!draft) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await axios.patch(`/api/playlist-recipes/${draft.id}`, {
        name: draft.name, description: draft.description, category: draft.category, artworkUrl: draft.artworkUrl,
        enabled: draft.enabled, filters: draft.filters, scoring: draft.scoring, targets: draft.targets,
        bpmFlow: draft.bpmFlow, discovery: draft.discovery, variety: draft.variety,
        playlistIdentity: draft.playlistIdentity, refreshPolicy: draft.refreshPolicy, automationPolicy: draft.automationPolicy,
        ...(draft.inheritanceEnabled || draft.baseRecipeId || draft.recipeCategoryId || draft.transitionPresetId || draft.discoveryPresetId || draft.varietyPresetId || draft.automationPresetId ? {
          baseRecipeId: draft.baseRecipeId, recipeCategoryId: draft.recipeCategoryId, transitionPresetId: draft.transitionPresetId,
          discoveryPresetId: draft.discoveryPresetId, varietyPresetId: draft.varietyPresetId, automationPresetId: draft.automationPresetId,
        } : {}),
      });
      setRecipe(response.data.recipe); setDraft(structuredClone(response.data.recipe)); setNotice(`Saved recipe v${response.data.recipe.recipeVersion}.`);
      setResolution((await axios.get(`/api/playlist-recipes/${draft.id}/effective-configuration`)).data);
    } catch (caught: any) { setError(caught.response?.data?.error || "Unable to save this recipe."); }
    finally { setSaving(false); }
  }

  async function validate() {
    if (!draft) return;
    if (dirty) await save();
    setValidating(true);
    try {
      const response = await axios.post(`/api/playlist-recipes/${draft.id}/validate`);
      setDraft((current) => current ? { ...current, validation: response.data.result } : current);
      setNotice(response.data.result.valid ? "Recipe is valid and ready to use." : "Recipe needs attention before generation.");
      setActiveSection("Validation");
    } catch (caught: any) { setError(caught.response?.data?.error || "Validation failed."); }
    finally { setValidating(false); }
  }

  async function duplicate(mode = "independent") {
    if (!draft) return;
    const response = await axios.post(`/api/playlist-recipes/${draft.id}/duplicate`, { mode });
    router.push(`/recipes/${response.data.recipe.id}`);
  }

  async function previewInheritance() {
    if (!draft) return; setError("");
    try { const response = await axios.post(`/api/playlist-recipes/${draft.id}/effective-configuration`, { proposedChanges: { baseRecipeId: draft.baseRecipeId, recipeCategoryId: draft.recipeCategoryId, transitionPresetId: draft.transitionPresetId, discoveryPresetId: draft.discoveryPresetId, varietyPresetId: draft.varietyPresetId, automationPresetId: draft.automationPresetId } }); setResolution(response.data); setActiveSection("Effective Configuration"); }
    catch (caught: any) { setError(caught.response?.data?.error || "Inheritance preview failed."); }
  }

  async function resetField(fieldPath: string) {
    if (!draft) return;
    try { const response = await axios.delete(`/api/playlist-recipes/${draft.id}/overrides`, { data: { fieldPaths: [fieldPath] } }); setResolution(response.data); setNotice(`${fieldPath} now follows its inherited source.`); }
    catch (caught: any) { setError(caught.response?.data?.error || "Could not reset that field."); }
  }

  async function remove() {
    if (!draft || !window.confirm(`Delete "${draft.name}"? ${draft.playlistCount || 0} generated playlist(s) will be retained.`)) return;
    await axios.delete(`/api/playlist-recipes/${draft.id}`);
    router.push("/recipes");
  }

  async function restoreBuiltIn() {
    if (!draft?.sourceRecipeId || !window.confirm(`Restore “${draft.name}” to the current built-in defaults? Your customized recipe settings will be replaced. Existing playlists will not change.`)) return;
    setSaving(true); setError("");
    try {
      const response = await axios.post(`/api/playlist-recipes/${draft.id}/restore-built-in`);
      setRecipe(response.data.recipe); setDraft(structuredClone(response.data.recipe));
      setNotice(`Restored built-in defaults from source version ${response.data.recipe.sourceRecipeVersion}.`);
    } catch (caught: any) { setError(caught.response?.data?.error || "Built-in defaults could not be restored."); }
    finally { setSaving(false); }
  }

  function communityMetadata() {
    if (!draft) return null;
    const authorName = window.prompt("Community recipe author name", draft.community?.author?.name || "")?.trim();
    if (!authorName) return null;
    const license = window.prompt("License identifier", draft.community?.license || "MIT")?.trim();
    if (!license) return null;
    const version = window.prompt("Community recipe version", draft.community?.version || "1.0.0")?.trim();
    if (!version) return null;
    const authorUrl = window.prompt("Author HTTPS URL (optional)", draft.community?.author?.url || "")?.trim() || null;
    const minimumMixarrVersion = window.prompt("Minimum Mixarr version", draft.community?.minimumMixarrVersion || "2.3.5")?.trim() || null;
    const homepage = window.prompt("Homepage HTTPS URL (optional)", draft.community?.homepageUrl || "")?.trim() || null;
    const documentationUrl = window.prompt("Documentation HTTPS URL (optional)", draft.community?.documentationUrl || "")?.trim() || null;
    const sourceUrl = window.prompt("Source HTTPS URL (optional)", draft.community?.sourceUrl || "")?.trim() || null;
    const tags = (window.prompt("Community tags, separated by commas", (draft.community?.tags || []).join(", ")) || "").split(",").map((value) => value.trim()).filter(Boolean);
    const changelog = window.prompt("Changelog text (optional)", draft.community?.changelog || "")?.trim() || null;
    return { author: { name: authorName, url: authorUrl }, license, version, recipeId: draft.community?.recipeId || `local.mixarr.${draft.slug}`, description: draft.description || "", homepage, tags, minimumMixarrVersion, documentationUrl, sourceUrl, changelog };
  }

  async function exportCommunity(type: "json" | "bundle") {
    if (!draft) return; const metadata = communityMetadata(); if (!metadata) return; setSaving(true); setError("");
    try { const response = await axios.post(`/api/playlist-recipes/${draft.id}/community/export`, { type, metadata }, { responseType: "blob" }); const disposition = response.headers["content-disposition"] || ""; const filename = disposition.match(/filename="([^"]+)"/)?.[1] || `${draft.slug}.mixarr-recipe.${type === "bundle" ? "zip" : "json"}`; const href = URL.createObjectURL(response.data); const anchor = document.createElement("a"); anchor.href = href; anchor.download = filename; anchor.click(); URL.revokeObjectURL(href); setNotice(`Community ${type === "bundle" ? "bundle" : "JSON"} exported.`); }
    catch { setError("Community export failed."); } finally { setSaving(false); }
  }

  async function copyShareCode() {
    if (!draft) return; const metadata = communityMetadata(); if (!metadata) return; setSaving(true); setError("");
    try { const response = await axios.post(`/api/playlist-recipes/${draft.id}/community/code`, { metadata }); await navigator.clipboard.writeText(response.data.code); setNotice(`Share code copied (${response.data.characterCount} characters). Its checksum detects corruption but does not prove authorship.`); }
    catch (caught: any) { setError(caught.response?.data?.error || "Share code could not be copied."); } finally { setSaving(false); }
  }

  async function reportCommunity() {
    if (!draft?.community) return; const category = window.prompt("Report category (for example: Suspicious content or Broken recipe)", "Broken recipe"); if (!category) return; const description = window.prompt("Optional description", "") || "";
    try { const response = await axios.post(`/api/playlist-recipes/${draft.id}/community/report`, { category, description }); await navigator.clipboard.writeText(response.data.text); if (response.data.issueUrl && window.confirm("Sanitized report copied. Open a prefilled GitHub issue too?")) window.open(response.data.issueUrl, "_blank", "noopener,noreferrer"); else setNotice("Sanitized community recipe report copied. It excludes credentials, paths, server details, and logs."); }
    catch (caught: any) { setError(caught.response?.data?.error || "The report could not be created."); }
  }

  async function governanceAction(action: "approve" | "reject" | "revalidate" | "revoke") {
    if (!draft) return; setSaving(true); setError("");
    try {
      if (action === "approve") await axios.post(`/api/recipes/${draft.id}/approval`, { mode: "suggest_only", grantedPermissions: draft.governance?.requestedPermissions?.filter((item: any) => item.decision === "allow").map((item: any) => item.permission) || [], confirmConsequences: [] });
      else if (action === "reject") { const reason = window.prompt("Specific reason for rejecting this recipe"); if (!reason) return; await axios.post(`/api/recipes/${draft.id}/reject`, { reason }); }
      else if (action === "revoke") await axios.delete(`/api/recipes/${draft.id}/approval`);
      else await axios.post(`/api/recipes/${draft.id}/revalidate`);
      window.location.reload();
    } catch (caught: any) { setError(caught.response?.data?.error || "The governance action failed."); } finally { setSaving(false); }
  }

  async function previewMigration() {
    if (!draft) return; setSaving(true); setError("");
    try { setMigrationPlan((await axios.get(`/api/recipes/${draft.id}/migration`)).data); }
    catch (caught: any) { setError(caught.response?.data?.error || "Migration preview failed."); }
    finally { setSaving(false); }
  }

  async function applyMigration() {
    if (!draft || !migrationPlan?.diffHash) return;
    const changeSummary = (migrationPlan.changes || []).map((item: any) => item.message).join("\n") || "Normalize this recipe to the current schema and require approval again.";
    if (!window.confirm(`Apply this reviewed migration?\n\n${changeSummary}\n\nThe original payload and a restore snapshot will be preserved.`)) return;
    setSaving(true); setError("");
    try { await axios.post(`/api/recipes/${draft.id}/migration`, { diffHash: migrationPlan.diffHash }); window.location.reload(); }
    catch (caught: any) { setError(caught.response?.data?.error || "Migration failed."); }
    finally { setSaving(false); }
  }

  async function previewSnapshot(snapshotId: string) {
    setSaving(true); setError("");
    try { setRestorePlan((await axios.get(`/api/recipes/snapshots/${snapshotId}/preview`)).data); }
    catch (caught: any) { setError(caught.response?.data?.error || "Restore preview failed."); }
    finally { setSaving(false); }
  }

  async function restoreSnapshot() {
    if (!restorePlan?.snapshot?.id) return;
    const consequence = restorePlan.restoreAction === "REMOVE_IMPORTED_RECIPE" ? "The imported recipe will be disabled and moved out of the active library." : "The recipe configuration shown under Before will replace its current configuration.";
    if (!window.confirm(`Restore snapshot from ${new Date(restorePlan.snapshot.createdAt).toLocaleString()}?\n\n${consequence}${restorePlan.conflicts?.length ? "\n\nA later recipe change was detected and will be overwritten." : ""}`)) return;
    setSaving(true); setError("");
    try { await axios.post(`/api/recipes/snapshots/${restorePlan.snapshot.id}/restore`, { confirmConflicts: Boolean(restorePlan.conflicts?.length) }); window.location.reload(); }
    catch (caught: any) { setError(caught.response?.data?.error || "Restore failed."); }
    finally { setSaving(false); }
  }

  async function generate() {
    if (!draft || !playlistName.trim()) return;
    if (dirty) { setError("Save recipe changes before creating a playlist."); return; }
    setGenerating(true); setError("");
    try {
      const option = libraries.find((item) => item.id === libraryId);
      const response = await axios.post(`/api/playlist-recipes/${draft.id}/create-playlist`, {
        playlistName,
        overrides: libraryId ? { libraryId, serverId: option?.serverId || null } : {},
        confirmAutomation,
      });
      setNotice(`Created "${playlistName}" with ${response.data.trackCount} tracks.`);
      router.push("/generated-playlists");
    } catch (caught: any) { setError(caught.response?.data?.error || "Playlist generation failed."); }
    finally { setGenerating(false); }
  }

  if (loading) return <main className={styles.state}><Loader2 className="animate-spin" /> Loading recipe…</main>;
  if (error && !draft) return <main className={styles.state}><AlertCircle /> {error}</main>;
  if (!draft) return null;

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><Link href="/recipes" className={styles.back}><ArrowLeft size={15} /> Recipe Library</Link><h2>{draft.name}</h2><p>Schema v{draft.schemaVersion} · Recipe v{draft.recipeVersion} · {draft.category}</p></div>
      <div className={styles.headerActions}><Link href={`/recipes/${draft.id}/edit`} className={styles.primary}><Edit3 size={15} /> Open Studio</Link><Link href={`/recipes/${draft.id}/compare`}><GitCompareArrows size={15} /> Compare</Link><button onClick={() => exportCommunity("json")}><Share2 size={15} /> Community JSON</button><button onClick={() => exportCommunity("bundle")}><Download size={15} /> Community bundle</button><button onClick={copyShareCode}><Copy size={15} /> Copy share code</button><button onClick={() => setShowClone(true)}><Copy size={15} /> Clone</button><button onClick={validate} disabled={validating}>{validating ? <Loader2 className="animate-spin" size={15} /> : <CheckCircle2 size={15} />} Validate</button><button className={styles.primary} onClick={save} disabled={!dirty || saving}>{saving ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />} Save</button></div>
    </header>
    {draft.sourceRecipeId && <div className={styles.sourceBanner}><Sparkles size={18} /><div><strong>Started from {sourceDetails?.name || draft.sourceRecipeId}</strong><p>Installed source v{draft.sourceRecipeVersion || "unknown"}{sourceDetails ? ` · Bundled source v${sourceDetails.version}` : ""}. Your customizations are never overwritten automatically.</p></div>{sourceDetails?.installedRecipe?.updateStatus === "update_available" && <span>Update available</span>}<Link href={`/recipes/library`}>View built-in</Link><button onClick={restoreBuiltIn} disabled={saving}><RotateCcw size={15} /> Restore original</button></div>}
    {draft.community && <section className={styles.communityBanner} aria-label="Community recipe attribution"><ShieldAlert size={20} /><div><strong>{draft.community.trustState.replaceAll("_", " ")} community recipe{draft.community.locallyModified ? " · locally modified" : ""}</strong><p>Created by {draft.community.author?.name || "Unknown author"} · v{draft.community.version || "unknown"} · {draft.community.license || "license not declared"} · imported {draft.importedAt ? new Date(draft.importedAt).toLocaleDateString() : "date unknown"}. Mixarr did not create, endorse, or guarantee this third-party recipe.</p><div className={styles.communityLinks}>{draft.community.sourceUrl && <a href={draft.community.sourceUrl} target="_blank" rel="noopener noreferrer">Source</a>}{draft.community.documentationUrl && <a href={draft.community.documentationUrl} target="_blank" rel="noopener noreferrer">Documentation</a>}{draft.community.homepageUrl && <a href={draft.community.homepageUrl} target="_blank" rel="noopener noreferrer">Homepage</a>}{(draft.community.tags || []).map((tag: string) => <span key={tag}>{tag}</span>)}</div></div><div className={styles.communityActions}>{draft.community.sourceUrl && <Link href={`/recipes/community?url=${encodeURIComponent(draft.community.sourceUrl)}`}><RefreshCw size={14} /> Check for update</Link>}<button onClick={reportCommunity}><Flag size={14} /> Report Recipe</button></div></section>}
    {draft.community && ((draft.community.screenshots || []).length > 0 || draft.community.changelog) && <section className={styles.communityMedia} aria-label="Community recipe media and changelog">{(draft.community.screenshots || []).length > 0 && <div className={styles.communityGallery}>{draft.community.screenshots.map((screenshot: string, index: number) => <img key={screenshot} src={screenshot} loading="lazy" alt={`${draft.name} community screenshot ${index + 1}`} />)}</div>}{draft.community.changelog && <details><summary>Community recipe changelog</summary><pre>{draft.community.changelog}</pre></details>}</section>}
    {notice && <div className={styles.notice}><CheckCircle2 size={16} /> {notice}</div>}
    {error && <div className={styles.error}><AlertCircle size={16} /> {error}</div>}
    <div className={styles.workspace}>
      <nav className={styles.tabs} aria-label="Recipe editor sections">{sections.map((section) => <button key={section} data-active={activeSection === section} onClick={() => setActiveSection(section)}>{section}</button>)}</nav>
      <section className={styles.editor}>
        {activeSection === "Recipe Foundation" && <Section title="Recipe Foundation" hint="Build this recipe from reusable layers. Previewing never saves changes.">
          <div className={styles.two}><Field label="Base recipe"><select value={draft.baseRecipeId || ""} onChange={(event) => updateRoot("baseRecipeId", event.target.value || null)}><option value="">No base recipe</option>{recipeOptions.filter((item) => item.id !== draft.id).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field><Field label="Category preset"><select value={draft.recipeCategoryId || ""} onChange={(event) => updateRoot("recipeCategoryId", event.target.value || null)}><option value="">No category preset</option>{categoryOptions.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field></div>
          <div className={styles.two}>{[["transitionPresetId","Transition preset","TRANSITION"],["discoveryPresetId","Discovery preset","DISCOVERY"],["varietyPresetId","Variety preset","VARIETY"],["automationPresetId","Automation policy","AUTOMATION"]].map(([key,label,type]) => <Field label={label} key={key}><select value={draft[key] || ""} onChange={(event) => updateRoot(key, event.target.value || null)}><option value="">No {label.toLowerCase()}</option>{presetOptions.filter((item) => item.type === type).map((item) => <option value={item.id} key={item.id}>{item.name} · v{item.version}</option>)}</select></Field>)}</div>
          <div className={styles.actions}><button onClick={previewInheritance}><Layers3 size={15} /> Preview effective settings</button><Link href="/settings/recipe-presets"><GitBranch size={15} /> Manage presets and policies</Link></div>
          <div className={styles.summary}><strong>Inheritance summary</strong><p>{resolution?.fields?.filter((field: any) => field.state === "inherited").length || 0} inherited · {resolution?.fields?.filter((field: any) => field.isCustomized).length || 0} customized · {resolution?.lockedFields?.length || 0} locked · {resolution?.conflicts?.length || 0} conflicts</p></div>
        </Section>}
        {activeSection === "Overview" && <>
          <Section title="Overview" hint="Recipe metadata never changes generated playlist tracks.">
            <Field label="Name"><input value={draft.name} onChange={(event) => updateRoot("name", event.target.value)} /></Field>
            <Field label="Description"><textarea rows={4} value={draft.description || ""} onChange={(event) => updateRoot("description", event.target.value)} /></Field>
            <div className={styles.two}><Field label="Category"><select value={draft.category} onChange={(event) => updateRoot("category", event.target.value)}>{categories.map((category) => <option key={category}>{category}</option>)}</select></Field><Field label="Artwork URL"><input value={draft.artworkUrl || ""} onChange={(event) => updateRoot("artworkUrl", event.target.value || null)} placeholder="Category fallback used when blank" /></Field></div>
            <label className={styles.toggle}><input type="checkbox" checked={draft.enabled} onChange={(event) => updateRoot("enabled", event.target.checked)} /> Recipe enabled</label>
            <div className={styles.summary}><strong>Recipe summary</strong><p>{humanSummary(draft)}</p></div>
          </Section>
          <Section title="Create playlist" hint="Playlist-only overrides never modify the recipe.">
            <Field label="Playlist name"><input value={playlistName} onChange={(event) => setPlaylistName(event.target.value)} /></Field>
            <Field label="Plex music library"><select value={libraryId} onChange={(event) => setLibraryId(event.target.value)}><option value="">Recipe default</option>{libraries.map((library) => <option key={library.id} value={library.id}>{library.label} ({library.tracks.toLocaleString()} tracks)</option>)}</select></Field>
            <p className={styles.caption}><b>Recipe defaults:</b> all saved strategy sections. <b>Playlist-only overrides:</b> name and selected library.</p>
            {draft.automationPolicy.enabled && <label className={styles.toggle}><input type="checkbox" checked={confirmAutomation} onChange={(event) => setConfirmAutomation(event.target.checked)} /> Explicitly activate this recipe’s automation policy</label>}
            <div className={styles.actions}><Link href={`/builder?recipeId=${draft.id}&preview=1`}><Play size={15} /> Preview in Builder</Link><button className={styles.primary} onClick={generate} disabled={generating}>{generating ? <Loader2 className="animate-spin" size={15} /> : <Wand2 size={15} />} Create playlist</button></div>
          </Section>
        </>}
        {activeSection === "Mood and Energy" && <Section title="Mood and Energy" hint="Use Mixarr mood names separated by commas.">
          <Field label="Selected moods"><input value={(draft.targets.selectedMoods || []).join(", ")} onChange={(event) => update("targets", "selectedMoods", listValue(event.target.value))} /></Field>
          <div className={styles.two}><Field label="Primary mood"><input value={draft.targets.primaryMood || ""} onChange={(event) => update("targets", "primaryMood", event.target.value || null)} /></Field><Field label="Blend mode"><select value={draft.targets.moodBlendMode} onChange={(event) => update("targets", "moodBlendMode", event.target.value)}><option value="off">Off</option><option value="smooth_transition">Smooth transition</option><option value="strict_matching">Strict matching</option><option value="mixed_mood">Mixed mood</option></select></Field></div>
          <label className={styles.toggle}><input type="checkbox" checked={draft.targets.strictMoodMatching} onChange={(event) => update("targets", "strictMoodMatching", event.target.checked)} /> Strict mood matching</label>
          <div className={styles.three}><NumberField label="Minimum energy" value={draft.targets.minimumEnergy} onChange={(value) => update("targets", "minimumEnergy", value)} step="0.05" /><NumberField label="Target energy" value={draft.targets.targetEnergy} onChange={(value) => update("targets", "targetEnergy", value)} step="0.05" /><NumberField label="Maximum energy" value={draft.targets.maximumEnergy} onChange={(value) => update("targets", "maximumEnergy", value)} step="0.05" /></div>
          <Field label="Energy progression"><select value={draft.targets.energyProgression} onChange={(event) => update("targets", "energyProgression", event.target.value)}>{["steady", "rising", "falling", "wave", "mixed"].map((value) => <option key={value}>{value}</option>)}</select></Field>
        </Section>}
        {activeSection === "BPM Flow" && <Section title="BPM Flow" hint="The existing Smart Mix transition engine applies these settings.">
          <div className={styles.three}><NumberField label="Minimum BPM" value={draft.bpmFlow.minimumBpm} onChange={(value) => update("bpmFlow", "minimumBpm", value)} /><NumberField label="Target BPM" value={draft.bpmFlow.targetBpm} onChange={(value) => update("bpmFlow", "targetBpm", value)} /><NumberField label="Maximum BPM" value={draft.bpmFlow.maximumBpm} onChange={(value) => update("bpmFlow", "maximumBpm", value)} /></div>
          <div className={styles.two}><Field label="Flow mode"><select value={draft.bpmFlow.mode} onChange={(event) => update("bpmFlow", "mode", event.target.value)}>{["DISABLED", "NATURAL", "RAMP_UP", "RAMP_DOWN", "STEADY", "CUSTOM"].map((value) => <option key={value}>{value.replaceAll("_", " ")}</option>)}</select></Field><NumberField label="Maximum BPM gap" value={draft.bpmFlow.maximumBpmGap} onChange={(value) => update("bpmFlow", "maximumBpmGap", value)} /></div>
          <label className={styles.toggle}><input type="checkbox" checked={draft.bpmFlow.allowBpmJumps} onChange={(event) => update("bpmFlow", "allowBpmJumps", event.target.checked)} /> Allow BPM jumps</label>
          <label className={styles.toggle}><input type="checkbox" checked={draft.bpmFlow.halfTimeMatching} onChange={(event) => update("bpmFlow", "halfTimeMatching", event.target.checked)} /> Half-time matching</label>
          <label className={styles.toggle}><input type="checkbox" checked={draft.bpmFlow.doubleTimeMatching} onChange={(event) => update("bpmFlow", "doubleTimeMatching", event.target.checked)} /> Double-time matching</label>
        </Section>}
        {activeSection === "Discovery" && <Section title="Discovery" hint="Discovery remains bounded by compatibility and safety rules.">
          <Field label="Discovery level"><select value={draft.discovery.level} onChange={(event) => update("discovery", "level", event.target.value)}>{["low", "medium", "high", "custom"].map((value) => <option key={value}>{value}</option>)}</select></Field>
          <Slider label="Deep-cut percentage" value={draft.discovery.deepCutPercentage} onChange={(value) => update("discovery", "deepCutPercentage", value)} />
          <Slider label="Familiarity balance" value={draft.discovery.familiarityBalance} onChange={(value) => update("discovery", "familiarityBalance", value)} />
          <Slider label="Maximum high-popularity tracks" value={draft.discovery.maximumHighPopularityPercentage} onChange={(value) => update("discovery", "maximumHighPopularityPercentage", value)} />
          {[['avoidOverplayedTracks','Avoid overplayed tracks'],['favorUnderplayedPlexTracks','Favor underplayed Plex tracks'],['favorTracksNotRecentlyUsed','Favor tracks not recently used'],].map(([key,label]) => <label className={styles.toggle} key={key}><input type="checkbox" checked={draft.discovery[key]} onChange={(event) => update("discovery", key, event.target.checked)} /> {label}</label>)}
        </Section>}
        {activeSection === "Scoring" && <Section title="Scoring" hint="Recipes describe weights; the Smart Mix engine performs scoring.">
          {[['moodMatchWeight','Mood match'],['energyMatchWeight','Energy match'],['bpmCompatibilityWeight','BPM compatibility'],['popularityWeight','Popularity'],['discoveryWeight','Discovery'],['playlistIdentityWeight','Playlist identity'],['transitionQualityWeight','Transition quality'],['personalizedScoringInfluence','Personalization influence']].map(([key,label]) => <Slider key={key} label={label} value={draft.scoring[key]} onChange={(value) => update("scoring", key, value)} />)}
          <div className={styles.two}><Field label="Scoring mode"><select value={draft.scoring.scoringMode} onChange={(event) => update("scoring", "scoringMode", event.target.value)}><option value="base">Base</option><option value="personalized">Personalized</option></select></Field><Field label="Scoring model"><select value={draft.scoring.scoringModel} onChange={(event) => update("scoring", "scoringModel", event.target.value)}><option value="stable-v2">Stable v2</option><option value="experimental-balanced">Experimental balanced</option></select></Field></div>
        </Section>}
        {activeSection === "Artist and Album Variety" && <Section title="Artist and Album Variety" hint="Limits use safe defaults when metadata is incomplete.">
          <div className={styles.two}><NumberField label="Maximum tracks per artist" value={draft.variety.maximumTracksPerArtist} onChange={(value) => update("variety", "maximumTracksPerArtist", value)} /><NumberField label="Minimum artist spacing" value={draft.variety.minimumArtistSpacing} onChange={(value) => update("variety", "minimumArtistSpacing", value)} /></div>
          <div className={styles.two}><NumberField label="Maximum tracks per album" value={draft.variety.maximumTracksPerAlbum} onChange={(value) => update("variety", "maximumTracksPerAlbum", value)} /><NumberField label="Minimum album spacing" value={draft.variety.minimumAlbumSpacing} onChange={(value) => update("variety", "minimumAlbumSpacing", value)} /></div>
          <Field label="Duplicate handling"><select value={draft.variety.duplicateTrackHandling} onChange={(event) => update("variety", "duplicateTrackHandling", event.target.value)}><option value="avoid">Avoid</option><option value="allow">Allow</option><option value="prefer_best_copy">Prefer best copy</option></select></Field>
          <Slider label="Repeat tolerance" value={draft.variety.repeatTolerance} onChange={(value) => update("variety", "repeatTolerance", value)} />
        </Section>}
        {activeSection === "Playlist Identity" && <Section title="Playlist Identity Defaults" hint="Each playlist receives an independent identity initialized from these defaults.">
          <Field label="Personality summary"><textarea rows={4} value={draft.playlistIdentity.personalitySummary} onChange={(event) => update("playlistIdentity", "personalitySummary", event.target.value)} /></Field>
          <Field label="Core moods"><input value={(draft.playlistIdentity.coreMoods || []).join(", ")} onChange={(event) => update("playlistIdentity", "coreMoods", listValue(event.target.value))} /></Field>
          <div className={styles.two}><Field label="Preferred genres"><input value={(draft.playlistIdentity.preferredGenres || []).join(", ")} onChange={(event) => update("playlistIdentity", "preferredGenres", listValue(event.target.value))} /></Field><Field label="Avoided genres"><input value={(draft.playlistIdentity.avoidedGenres || []).join(", ")} onChange={(event) => update("playlistIdentity", "avoidedGenres", listValue(event.target.value))} /></Field></div>
          <label className={styles.toggle}><input type="checkbox" checked={draft.playlistIdentity.identityLearningEnabled} onChange={(event) => update("playlistIdentity", "identityLearningEnabled", event.target.checked)} /> Identity learning enabled for new playlists</label>
          <label className={styles.toggle}><input type="checkbox" checked={draft.playlistIdentity.personalizationEnabled} onChange={(event) => update("playlistIdentity", "personalizationEnabled", event.target.checked)} /> Apply the current user’s personalization</label>
          <Slider label="Maximum personalization influence" value={draft.playlistIdentity.maximumPersonalizationInfluence} onChange={(value) => update("playlistIdentity", "maximumPersonalizationInfluence", value)} />
        </Section>}
        {activeSection === "Refresh and Automation" && <Section title="Refresh and Automation" hint="Creating or editing a recipe never activates automation by itself.">
          <div className={styles.two}><Field label="Refresh mode"><select value={draft.refreshPolicy.mode} onChange={(event) => update("refreshPolicy", "mode", event.target.value)}><option value="manual">Manual only</option><option value="scheduled">Scheduled</option></select></Field><NumberField label="Frequency (days)" value={draft.refreshPolicy.frequencyDays} onChange={(value) => update("refreshPolicy", "frequencyDays", value)} /></div>
          <Field label="Refresh strategy"><select value={draft.refreshPolicy.strategy} onChange={(event) => update("refreshPolicy", "strategy", event.target.value)}><option value="replace_weak">Replace weak tracks only</option><option value="full_regeneration">Full regeneration</option></select></Field>
          <Slider label="Weak-track threshold" value={draft.refreshPolicy.weakTrackScoreThreshold} onChange={(value) => update("refreshPolicy", "weakTrackScoreThreshold", value)} />
          {[['preserveLockedTracks','Preserve locked tracks'],['preserveLikedTracks','Preserve liked tracks'],['preservePlaylistLength','Preserve playlist length'],['preserveMoodCurve','Preserve mood curve'],['preserveBpmCurve','Preserve BPM curve']].map(([key,label]) => <label className={styles.toggle} key={key}><input type="checkbox" checked={draft.refreshPolicy[key]} onChange={(event) => update("refreshPolicy", key, event.target.checked)} /> {label}</label>)}
          <hr /><label className={styles.toggle}><input type="checkbox" checked={draft.automationPolicy.enabled} onChange={(event) => update("automationPolicy", "enabled", event.target.checked)} /> Offer automation when creating a playlist (explicit confirmation still required)</label>
        </Section>}
        {activeSection === "Effective Configuration" && <Section title="Effective Configuration" hint="This is the exact validated configuration the Smart Mix Engine receives, with every source explained.">
          {resolution && <><div className={resolution.valid ? styles.valid : styles.invalid}>{resolution.valid ? <CheckCircle2 /> : <ShieldAlert />}<div><strong>{resolution.valid ? "Effective configuration is valid" : "Blocking conflicts must be resolved"}</strong><p>Resolver {resolution.resolverVersion} · fingerprint {resolution.fingerprint?.slice(0, 16)}…</p></div></div>
          <div className={styles.chain} aria-label="Inheritance chain">{resolution.inheritanceChain?.map((layer: any, index: number) => <div key={`${layer.type}-${layer.id}-${index}`}><span><Layers3 size={14} /> {layer.name}</span><small>{layer.type.replaceAll("_", " ")} {layer.version ? `· v${layer.version}` : ""}</small>{index < resolution.inheritanceChain.length - 1 && <ArrowDown size={14} />}</div>)}</div>
          {(resolution.conflicts || []).map((conflict: any) => <div className={styles.message} data-error={conflict.severity === "blocking"} key={`${conflict.code}-${conflict.fields.join()}`}><code>{conflict.severity} · {conflict.fields.join(", ")}</code><span>{conflict.message}<small>{conflict.suggestion}</small></span></div>)}
          <div className={styles.fieldProvenance}>{resolution.fields?.map((field: any) => <div key={field.field} data-state={field.state}><div><code>{field.field}</code><span className={styles.badge}>{field.state.replaceAll("_", " ")}</span>{field.isLocked && <LockKeyhole size={13} />}</div><strong>{typeof field.effectiveValue === "object" ? JSON.stringify(field.effectiveValue) : String(field.effectiveValue)}</strong><small>Source: {field.source.name}{field.inheritedFrom ? ` · inherited value ${JSON.stringify(field.inheritedValue)} from ${field.inheritedFrom.name}` : ""}</small>{field.isCustomized && <button onClick={() => resetField(field.field)}><RotateCcw size={13} /> Reset to inherited value</button>}</div>)}</div></>}
        </Section>}
        {activeSection === "Import Mapping" && <Section title="Import Compatibility & Mapping" hint="The original imported definition is preserved for comparison. Editing this recipe does not rewrite its import audit.">
          {draft.importAnalysis ? <><div className={styles.two}><div className={styles.valid}><CheckCircle2 /><div><strong>{draft.importAnalysis.compatibilityScore}% compatibility</strong><p>{draft.importAnalysis.library?.name || "Local library"} · {draft.importAnalysis.identityImpact.replaceAll("_", " ")} identity impact</p></div></div><div className={styles.valid}><CheckCircle2 /><div><strong>{draft.importAnalysis.adaptedCandidateEstimate} adapted candidates</strong><p>{draft.importAnalysis.originalCandidateEstimate} using the original definition</p></div></div></div>
          {draft.importAnalysis.mappings.map((mapping: any) => <div className={styles.message} key={mapping.id}><code>{mapping.mappingType}</code><span><b>{mapping.originalValue}</b> → {(mapping.mappedValuesJson || []).join(", ") || "No local mapping"}<small>{mapping.matchStatus.replaceAll("_", " ")} · {Math.round(mapping.confidence * 100)}% · {mapping.reason}</small></span></div>)}
          <details><summary>Compare preserved original recipe JSON</summary><pre>{JSON.stringify(draft.originalImportedRecipe, null, 2)}</pre></details></> : <p className={styles.empty}>This recipe was created locally or predates adaptive import analysis.</p>}
        </Section>}
        {activeSection === "Governance" && <Section title="Safety, Trust & Governance" hint="Trust, official status, approval, and restrictions are derived and enforced by the server.">
          {draft.governance ? <><div className={draft.governance.quarantineState === "NONE" ? styles.valid : styles.invalid}>{draft.governance.quarantineState === "NONE" ? <CheckCircle2 /> : <ShieldAlert />}<div><strong>{draft.governance.official ? "Official Recipe" : draft.governance.trustState.replaceAll("_", " ")}</strong><p>{draft.governance.approvalState.replaceAll("_", " ")} · {draft.governance.compatibilityStatus.replaceAll("_", " ")} · {draft.governance.riskLevel} risk ({draft.governance.riskScore}/100)</p></div></div>
          {draft.governance.quarantineReason && <div className={styles.invalid}><ShieldAlert /><div><strong>Quarantined</strong><p>{draft.governance.quarantineReason}</p></div></div>}
          <div className={styles.two}><div className={styles.summary}><strong>Signature</strong><p>{draft.governance.signatureStatus.replaceAll("_", " ")}{draft.governance.signerIdentity ? ` · ${draft.governance.signerIdentity}` : ""}{draft.governance.signatureKeyId ? ` · ${draft.governance.signatureKeyId}` : ""}</p></div><div className={styles.summary}><strong>Last validation</strong><p>{draft.governance.lastValidatedAt ? new Date(draft.governance.lastValidatedAt).toLocaleString() : "Not recorded"}</p></div></div>
          <h4>Requested permissions</h4>{draft.governance.requestedPermissions.map((item: any) => <div className={styles.message} data-error={item.decision === "deny"} key={item.permission || item}><code>{item.permission || item}</code><span>{item.reason || "Inferred legacy permission"}<small>{item.riskLevel ? `${item.riskLevel} · ${item.decision}${item.fallback ? ` · ${item.fallback}` : ""}` : ""}</small></span></div>)}
          <h4>Risk findings</h4>{draft.governance.riskFindings.length ? draft.governance.riskFindings.map((finding: any, index: number) => <div className={styles.message} data-error={["error","high","destructive"].includes(finding.severity)} key={`${finding.code}-${index}`}><code>{finding.code}</code><span>{finding.message}</span></div>) : <p className={styles.empty}>No governance risk findings.</p>}
          <h4>Dependencies</h4>{draft.governance.dependencies.length ? draft.governance.dependencies.map((dependency: any) => <div className={styles.message} data-error={dependency.required && dependency.status !== "AVAILABLE"} key={`${dependency.type}-${dependency.name}`}><code>{dependency.status}</code><span>{dependency.name}<small>{dependency.message}</small></span></div>) : <p className={styles.empty}>No declared external dependencies.</p>}
          <div className={styles.actions}><button onClick={() => void governanceAction("revalidate")}><RefreshCw size={15} /> Revalidate</button>{!["APPROVED","APPROVED_WITH_RESTRICTIONS"].includes(draft.governance.approvalState) && <button onClick={() => void governanceAction("approve")}><CheckCircle2 size={15} /> Approve safely</button>}{["APPROVED","APPROVED_WITH_RESTRICTIONS"].includes(draft.governance.approvalState) && <button onClick={() => void governanceAction("revoke")}><ShieldAlert size={15} /> Revoke approval</button>}<button onClick={() => void governanceAction("reject")}><X size={15} /> Reject</button><button onClick={() => void previewMigration()}><GitBranch size={15} /> Preview migration</button></div>
          {migrationPlan && <div className={styles.governancePanel} aria-label="Recipe migration preview"><strong>Migration preview</strong><p>Current payload to schema v{migrationPlan.normalized?.schemaVersion || "unknown"}. Applying this disables execution until local review.</p>{(migrationPlan.changes || []).map((item: any, index: number) => <div className={styles.message} key={`${item.code}-${index}`}><code>{item.path || "recipe"}</code><span>{item.message}</span></div>)}{(migrationPlan.errors || []).map((item: any, index: number) => <div className={styles.message} data-error="true" key={`${item.code}-${index}`}><code>{item.path || "recipe"}</code><span>{item.message}</span></div>)}<button disabled={!migrationPlan.normalized || migrationPlan.errors?.length} onClick={() => void applyMigration()}><GitBranch size={15} /> Apply reviewed migration</button></div>}
          <h4>Migration history</h4>{draft.governance.migrationHistory?.length ? draft.governance.migrationHistory.map((entry: any, index: number) => <div className={styles.message} key={`${entry.migratedAt}-${index}`}><code>v{entry.fromSchemaVersion} → v{entry.toSchemaVersion}</code><span>{new Date(entry.migratedAt).toLocaleString()}<small>Permissions were not increased.</small></span></div>) : <p className={styles.empty}>No recipe migrations recorded.</p>}
          <h4>Restore snapshots</h4>{snapshots.length ? snapshots.map((snapshot: any) => <div className={styles.snapshotRow} key={snapshot.id}><span><strong>{new Date(snapshot.createdAt).toLocaleString()}</strong><small>{snapshot.reason} · correlation {snapshot.correlationId} · {snapshot.status.toLowerCase()}</small></span><button disabled={snapshot.status !== "AVAILABLE"} onClick={() => void previewSnapshot(snapshot.id)}>Preview restore</button></div>) : <p className={styles.empty}>No import or migration snapshots are available.</p>}
          {restorePlan && <div className={styles.governancePanel} aria-label="Restore preview"><strong>{restorePlan.restoreAction === "REMOVE_IMPORTED_RECIPE" ? "Remove imported recipe" : "Restore pre-import configuration"}</strong><p>Snapshot {new Date(restorePlan.snapshot.createdAt).toLocaleString()} · correlation {restorePlan.snapshot.correlationId}</p>{restorePlan.conflicts?.map((conflict: any) => <div className={styles.invalid} key={conflict.code}><AlertCircle /><div><strong>{conflict.code}</strong><p>{conflict.message}</p></div></div>)}<details><summary>Before and current configuration</summary><div className={styles.diffGrid}><pre>{JSON.stringify(restorePlan.before, null, 2)}</pre><pre>{JSON.stringify(restorePlan.current, null, 2)}</pre></div></details><button disabled={!restorePlan.restorable} onClick={() => void restoreSnapshot()}><RotateCcw size={15} /> Confirm atomic restore</button></div>}
          <h4>Immutable audit history</h4>{auditEvents.length ? auditEvents.map((event: any) => <div className={styles.auditRow} key={event.id}><span><strong>{event.eventType.replaceAll("_", " ")}</strong><small>{new Date(event.createdAt).toLocaleString()} · {event.result} · correlation {event.correlationId}{event.trustState ? ` · ${event.trustState}` : ""}</small></span><p>{event.description}</p></div>) : <p className={styles.empty}>No governance audit events recorded.</p>}</> : <p className={styles.empty}>Governance metadata will be created by validation.</p>}
        </Section>}
        {activeSection === "Validation" && <Section title="Validation" hint="Validation does not load tracks or run playlist generation.">
          <div className={draft.validation.valid ? styles.valid : styles.invalid}>{draft.validation.valid ? <CheckCircle2 /> : <AlertCircle />}<div><strong>{draft.validation.valid ? "Recipe is valid" : "Recipe needs attention"}</strong><p>{draft.validation.errors.length} error(s), {draft.validation.warnings.length} warning(s)</p></div></div>
          {[...(draft.validation.errors || []), ...(draft.validation.warnings || [])].map((message: Message) => <div className={styles.message} key={`${message.path}-${message.code}`} data-error={draft.validation.errors.includes(message)}><code>{message.path || "recipe"}</code><span>{message.message}</span></div>)}
          <button onClick={validate} disabled={validating}>{validating ? <Loader2 className="animate-spin" size={15} /> : <CheckCircle2 size={15} />} Validate saved recipe</button>
        </Section>}
        {activeSection === "Generated Playlists" && <Section title="Generated Playlists" hint="Deleting the recipe will not delete these playlists.">
          {playlists.length ? <div className={styles.playlistList}>{playlists.map((playlist) => <Link href="/generated-playlists" key={playlist.id}><span><strong>{playlist.plexPlaylistTitle}</strong><small>{playlist.trackCount} tracks · recipe v{playlist.recipeVersionUsed || "legacy"}</small></span><small>{new Date(playlist.createdAt).toLocaleString()}</small></Link>)}</div> : <p className={styles.empty}>No playlists have been generated from this recipe yet.</p>}
        </Section>}
        <div className={styles.danger}><div><strong>Delete recipe</strong><p>Generated playlists, history, feedback, and Plex data are retained.</p></div><button onClick={remove}><Trash2 size={15} /> Delete</button></div>
      </section>
    </div>
    {showClone && <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-label="Clone recipe"><div className={styles.cloneDialog}><button className={styles.close} onClick={() => setShowClone(false)} aria-label="Close"><X /></button><h3>Clone with inheritance</h3><p>Choose how future changes should flow into the clone.</p>{[["linked","Linked Clone","Retain the same base, presets, and explicit overrides."],["child","Child Recipe","Use this recipe as the new base and start with no overrides."],["independent","Independent Copy","Store today’s effective values explicitly; future parent changes do not flow in."],["structure_only","Structure-Only Clone","Retain base and preset references without local overrides."]].map(([mode,label,description]) => <button key={mode} onClick={() => duplicate(mode)}><strong>{label}</strong><small>{description}</small></button>)}</div></div>}
  </main>;
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) { return <div className={styles.section}><header><h3>{title}</h3><p>{hint}</p></header>{children}</div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className={styles.field}><span>{label}</span>{children}</label>; }
function NumberField({ label, value, onChange, step = "1" }: { label: string; value: any; onChange: (value: number | null) => void; step?: string }) { return <Field label={label}><input type="number" step={step} value={value ?? ""} onChange={(event) => onChange(numberOrNull(event.target.value))} /></Field>; }
function Slider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <label className={styles.slider}><span>{label}<b>{value}%</b></span><input type="range" min="0" max="100" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>; }
