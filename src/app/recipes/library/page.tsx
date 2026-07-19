"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { ArrowLeft, BookOpen, Check, ChevronRight, EyeOff, Heart, Info, Library, Loader2, RefreshCw, RotateCcw, Search, SlidersHorizontal, Sparkles, Star, Wand2, X } from "lucide-react";
import Link from "next/link";
import styles from "./recipe-library.module.css";

type Requirement = { id: string; importance: "required" | "recommended" | "optional" };
type Compatibility = { level: "excellent" | "good" | "limited" | "poor" | "unavailable"; score: number; eligibleTrackCount: number; eligibleTrackCountExact: boolean; totalTrackCount: number; reasons: string[]; coverage: Record<string, number>; missingRequiredMetadata: string[]; missingRecommendedMetadata: string[]; libraryName: string | null; calculatedAt: string };
type LibraryRecipe = {
  id: string; version: number; name: string; shortDescription: string; longDescription: string; category: string; tags: string[];
  difficulty: "beginner" | "intermediate" | "advanced"; metadataRequirements: Requirement[]; discoveryLevel: string;
  estimatedDurationMinutes: number; targetTrackCount: number; behaviorSummary: string[]; importantExclusions: string[];
  expectedPlaylistShape: string; customizableFields: string[]; history: Array<{ version: number; appVersion: string; summary: string }>;
  preference: { favorite: boolean; hidden: boolean; lastUsedAt: string | null; lastUsedVersion: number | null; useCount: number };
  installedRecipe: null | { id: string; name: string; recipeVersion: number; sourceRecipeVersion: number | null; updateStatus: string };
  compatibility: Compatibility; advancedEngineConfig?: unknown;
};
type Payload = { recipes: LibraryRecipe[]; recentlyUsed: LibraryRecipe[]; categories: Array<{ id: string; label: string; count: number }>; summary: { total: number; visible: number; favorites: number; hidden: number; installed: number } };

const metadataLabels: Record<string, string> = { playback_history: "Playback history", ratings: "Ratings", bpm: "BPM", mood: "Mood", energy: "Energy", genre: "Genre", artist: "Artist metadata", album: "Album metadata", date_added: "Date added", release_year: "Release year", popularity: "Popularity", local_analysis: "Local analysis" };
const levelLabels: Record<string, string> = { excellent: "Excellent", good: "Good", limited: "Limited", poor: "Poor", unavailable: "Unavailable" };
const discoveryLabels: Record<string, string> = { none: "None", low: "Low", medium: "Medium", high: "High" };

function requirementLabel(requirement: Requirement) { return `${metadataLabels[requirement.id] || requirement.id.replaceAll("_", " ")} ${requirement.importance}`; }
function categoryLabel(categories: Payload["categories"], id: string) { return categories.find((item) => item.id === id)?.label || id.replaceAll("_", " "); }

export default function CuratedRecipeLibraryPage() {
  const router = useRouter();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [search, setSearch] = useState(""); const [categories, setCategories] = useState<Set<string>>(new Set());
  const [difficulty, setDifficulty] = useState("all"); const [metadata, setMetadata] = useState("all"); const [compatibility, setCompatibility] = useState("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false); const [hiddenMode, setHiddenMode] = useState(false); const [sort, setSort] = useState("recommended");
  const [details, setDetails] = useState<LibraryRecipe | null>(null); const [detailsLoading, setDetailsLoading] = useState(false); const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setPayload((await axios.get("/api/recipes/library", { params: hiddenMode ? { hidden: true } : undefined })).data); }
    catch { setError("The Curated Recipe Library could not be loaded."); }
    finally { setLoading(false); }
  }, [hiddenMode]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!details) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setDetails(null); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [details]);

  const displayed = useMemo(() => {
    const source = payload?.recipes || [];
    const filtered = source.filter((item) => !search || `${item.name} ${item.shortDescription} ${item.tags.join(" ")}`.toLowerCase().includes(search.toLowerCase()))
      .filter((item) => categories.size === 0 || categories.has(item.category))
      .filter((item) => difficulty === "all" || item.difficulty === difficulty)
      .filter((item) => metadata === "all" || item.metadataRequirements.some((requirement) => requirement.id === metadata))
      .filter((item) => compatibility === "all" || item.compatibility.level === compatibility)
      .filter((item) => !favoritesOnly || item.preference.favorite);
    return [...filtered].sort((left, right) => sort === "name" ? left.name.localeCompare(right.name)
      : sort === "compatibility" ? right.compatibility.score - left.compatibility.score || left.name.localeCompare(right.name)
      : sort === "recently_used" ? new Date(right.preference.lastUsedAt || 0).getTime() - new Date(left.preference.lastUsedAt || 0).getTime()
      : sort === "most_used" ? right.preference.useCount - left.preference.useCount || left.name.localeCompare(right.name)
      : Number(Boolean(right.preference.favorite)) - Number(Boolean(left.preference.favorite)) || right.compatibility.score - left.compatibility.score || left.name.localeCompare(right.name));
  }, [payload, search, categories, difficulty, metadata, compatibility, favoritesOnly, sort]);

  const patchRecipe = (recipeId: string, patch: Partial<LibraryRecipe>) => setPayload((current) => current ? {
    ...current,
    recipes: current.recipes.map((item) => item.id === recipeId ? { ...item, ...patch } : item),
    recentlyUsed: current.recentlyUsed.map((item) => item.id === recipeId ? { ...item, ...patch } : item),
  } : current);
  const toggleCategory = (id: string) => setCategories((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const updatePreference = async (recipe: LibraryRecipe, field: "favorite" | "hidden", value: boolean) => {
    setBusyId(recipe.id); setError("");
    const url = `/api/recipes/library/${encodeURIComponent(recipe.id)}/${field === "hidden" ? "hide" : "favorite"}`;
    try {
      value ? await axios.post(url) : await axios.delete(url);
      patchRecipe(recipe.id, { preference: { ...recipe.preference, [field]: value } });
      setDetails((current) => current?.id === recipe.id ? { ...current, preference: { ...current.preference, [field]: value } } : current);
      setNotice(field === "favorite" ? (value ? `Added “${recipe.name}” to favorites.` : `Removed “${recipe.name}” from favorites.`) : (value ? `Hidden “${recipe.name}”.` : `Restored “${recipe.name}”.`));
      if (field === "hidden") await load();
    } catch (caught: any) { setError(caught.response?.data?.error || "Recipe preference could not be updated."); }
    finally { setBusyId(""); }
  };
  const install = async (recipe: LibraryRecipe, customize = false) => {
    setBusyId(recipe.id); setError("");
    try {
      const response = await axios.post(`/api/recipes/library/${encodeURIComponent(recipe.id)}/install`);
      const installed = { id: response.data.recipe.id, name: response.data.recipe.name, recipeVersion: response.data.recipe.recipeVersion, sourceRecipeVersion: response.data.recipe.sourceRecipeVersion, updateStatus: "current" };
      const preference = { ...recipe.preference, lastUsedAt: new Date().toISOString(), lastUsedVersion: recipe.version, useCount: recipe.preference.useCount + 1 };
      patchRecipe(recipe.id, { installedRecipe: installed, preference });
      setDetails((current) => current?.id === recipe.id ? { ...current, installedRecipe: installed, preference } : current);
      setNotice(response.data.created ? `Installed “${recipe.name}”. It is ready in your Mix Recipes.` : `“${recipe.name}” is already installed.`);
      if (customize) router.push(`/recipes/${response.data.recipe.id}?from=${encodeURIComponent(recipe.id)}`);
    } catch (caught: any) { setError(caught.response?.data?.error || "Recipe installation failed."); }
    finally { setBusyId(""); }
  };
  const openRecipe = async (recipe: LibraryRecipe) => {
    if (!recipe.installedRecipe) return install(recipe, true);
    setBusyId(recipe.id);
    try { await axios.post(`/api/recipes/library/${encodeURIComponent(recipe.id)}/use`); router.push(`/recipes/${recipe.installedRecipe.id}`); }
    catch (caught: any) { setError(caught.response?.data?.error || "Recipe could not be opened."); setBusyId(""); }
  };
  const openDetails = async (recipe: LibraryRecipe) => {
    setDetails(recipe); setDetailsLoading(true);
    try { setDetails((await axios.get(`/api/recipes/library/${encodeURIComponent(recipe.id)}`)).data.recipe); }
    catch { setError("Recipe details could not be loaded."); }
    finally { setDetailsLoading(false); }
  };
  const restoreAll = async () => { setBusyId("restore-all"); try { const response = await axios.post("/api/recipes/library/hidden/restore-all"); setNotice(`Restored ${response.data.restored} hidden recipe${response.data.restored === 1 ? "" : "s"}.`); await load(); } catch { setError("Hidden recipes could not be restored."); } finally { setBusyId(""); } };
  const clearFilters = () => { setSearch(""); setCategories(new Set()); setDifficulty("all"); setMetadata("all"); setCompatibility("all"); setFavoritesOnly(false); };

  return <main className={styles.page}>
    <header className={styles.hero}>
      <div><Link href="/recipes" className={styles.back}><ArrowLeft size={15} /> My Mix Recipes</Link><span className={styles.kicker}><Sparkles size={15} /> Included with Mixarr · Available offline</span><h2>Curated Recipe Library</h2><p>Start with a polished playlist strategy, check how it fits your library, then install it or tune it in the existing Mix Recipe editor.</p></div>
      <div className={styles.heroStats}><span><b>{payload?.summary.total || 28}</b> bundled recipes</span><span><b>{payload?.summary.installed || 0}</b> installed</span><button onClick={() => setHiddenMode((value) => !value)} data-active={hiddenMode}><EyeOff size={16} /> {hiddenMode ? "Back to Library" : `Hidden (${payload?.summary.hidden || 0})`}</button></div>
    </header>
    {notice && <div className={styles.notice}><Check size={17} /><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss message"><X size={15} /></button></div>}
    {error && <div className={styles.error}><Info size={17} /><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error"><X size={15} /></button></div>}

    {!hiddenMode && payload?.recentlyUsed.length ? <section className={styles.recent}><header><div><RefreshCw size={17} /><span><b>Recently Used</b><small>Your latest installed or used starter recipes</small></span></div></header><div>{payload.recentlyUsed.map((recipe) => <button key={recipe.id} onClick={() => openDetails(recipe)}><span>{recipe.name}</span><small>{categoryLabel(payload.categories, recipe.category)}</small><ChevronRight size={15} /></button>)}</div></section> : null}

    <section className={styles.filters} aria-label="Recipe Library filters">
      <div className={styles.filterTop}><label className={styles.search}><Search size={17} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search recipes, outcomes, or tags" aria-label="Search curated recipes" /></label><label>Difficulty<select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}><option value="all">All levels</option><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label><label>Metadata<select value={metadata} onChange={(event) => setMetadata(event.target.value)}><option value="all">Any metadata</option>{Object.entries(metadataLabels).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label><label>Compatibility<select value={compatibility} onChange={(event) => setCompatibility(event.target.value)}><option value="all">Any status</option>{Object.entries(levelLabels).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label><label>Sort<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="recommended">Recommended</option><option value="compatibility">Compatibility</option><option value="recently_used">Recently used</option><option value="most_used">Most used</option><option value="name">Name</option></select></label></div>
      <div className={styles.categoryRow}><button onClick={() => setCategories(new Set())} data-active={!categories.size}>All <span>{payload?.summary.total || 0}</span></button>{payload?.categories.map((category) => <button key={category.id} onClick={() => toggleCategory(category.id)} data-active={categories.has(category.id)}>{category.label}<span>{category.count}</span></button>)}</div>
      <div className={styles.filterBottom}><label className={styles.favoriteFilter}><input type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)} /><Heart size={15} fill={favoritesOnly ? "currentColor" : "none"} /> Favorites only</label><span>{displayed.length} recipe{displayed.length === 1 ? "" : "s"}</span><button onClick={clearFilters}><RotateCcw size={14} /> Clear filters</button>{hiddenMode && <button onClick={restoreAll} disabled={busyId === "restore-all"}><RefreshCw size={14} /> Restore all hidden</button>}</div>
    </section>

    {loading ? <section className={styles.skeletonGrid} aria-label="Loading recipes">{Array.from({ length: 8 }, (_, index) => <div key={index}><i /><i /><i /><i /></div>)}</section>
      : displayed.length === 0 ? <section className={styles.empty}><BookOpen size={32} /><h3>{hiddenMode ? "No hidden recipes" : "No recipes match these filters"}</h3><p>{hiddenMode ? "Recipes you hide will appear here and can always be restored." : "Clear a filter or try a broader search."}</p>{!hiddenMode && <button onClick={clearFilters}><RotateCcw size={15} /> Clear filters</button>}</section>
      : <section className={styles.grid}>{displayed.map((recipe) => <article className={styles.card} key={recipe.id}>
        <header><div className={styles.cardBadges}><span className={styles.category}>{categoryLabel(payload!.categories, recipe.category)}</span><span data-difficulty={recipe.difficulty}>{recipe.difficulty}</span>{recipe.installedRecipe && <span className={styles.installed}><Check size={12} /> Installed</span>}{recipe.installedRecipe?.updateStatus === "update_available" && <span className={styles.update}>Update available</span>}</div><button className={styles.iconButton} onClick={() => updatePreference(recipe, "favorite", !recipe.preference.favorite)} aria-label={`${recipe.preference.favorite ? "Remove" : "Add"} ${recipe.name} ${recipe.preference.favorite ? "from" : "to"} favorites`} disabled={busyId === recipe.id}><Heart size={18} fill={recipe.preference.favorite ? "currentColor" : "none"} /></button></header>
        <div className={styles.cardCopy}><h3>{recipe.name}</h3><p>{recipe.shortDescription}</p></div>
        <div className={styles.requirements}>{recipe.metadataRequirements.length ? recipe.metadataRequirements.slice(0, 2).map((item) => <span key={`${item.id}-${item.importance}`} data-importance={item.importance}>{requirementLabel(item)}</span>) : <span data-importance="optional">No special metadata required</span>}{recipe.metadataRequirements.length > 2 && <span>+{recipe.metadataRequirements.length - 2} more</span>}</div>
        <div className={styles.compatibility} data-level={recipe.compatibility.level}><div><span>{levelLabels[recipe.compatibility.level]} compatibility</span><small>{recipe.compatibility.eligibleTrackCount.toLocaleString()} {recipe.compatibility.eligibleTrackCountExact ? "eligible" : "estimated eligible"} tracks</small></div><b>{recipe.compatibility.score}%</b></div>
        <dl><div><dt>Discovery</dt><dd>{discoveryLabels[recipe.discoveryLevel] || recipe.discoveryLevel}</dd></div><div><dt>Target</dt><dd>{recipe.targetTrackCount} tracks</dd></div><div><dt>Duration</dt><dd>~{recipe.estimatedDurationMinutes} min</dd></div></dl>
        <div className={styles.cardActions}><button className={styles.primary} onClick={() => recipe.installedRecipe ? openRecipe(recipe) : install(recipe)} disabled={busyId === recipe.id}>{busyId === recipe.id ? <Loader2 className="animate-spin" size={16} /> : recipe.installedRecipe ? <Wand2 size={16} /> : <Library size={16} />}{recipe.installedRecipe ? "Use Recipe" : "Install"}</button><button onClick={() => openDetails(recipe)}><BookOpen size={16} /> Details</button><button className={styles.more} onClick={() => updatePreference(recipe, "hidden", !recipe.preference.hidden)} aria-label={`${recipe.preference.hidden ? "Restore" : "Hide"} ${recipe.name}`}><EyeOff size={16} /></button></div>
      </article>)}</section>}

    {details && <div className={styles.modalLayer} role="dialog" aria-modal="true" aria-labelledby="recipe-detail-title"><button className={styles.backdrop} onClick={() => setDetails(null)} aria-label="Close recipe details" /><section className={styles.modal}>
      <header className={styles.modalHeader}><div><span className={styles.kicker}>{categoryLabel(payload?.categories || [], details.category)} · {details.difficulty}</span><h2 id="recipe-detail-title">{details.name}</h2><p>{details.longDescription}</p></div><button className={styles.iconButton} onClick={() => setDetails(null)} aria-label="Close recipe details"><X /></button></header>
      {detailsLoading ? <div className={styles.detailLoading}><Loader2 className="animate-spin" /> Calculating exact compatibility…</div> : <div className={styles.modalBody}>
        <section className={styles.detailCompatibility} data-level={details.compatibility.level}><div><span>{levelLabels[details.compatibility.level]} compatibility</span><b>{details.compatibility.eligibleTrackCount.toLocaleString()} eligible tracks</b><small>{details.compatibility.libraryName || "Current library"} · {details.compatibility.eligibleTrackCountExact ? "exact primary-filter count" : "aggregate estimate"}</small></div><strong>{details.compatibility.score}%</strong>{details.compatibility.reasons.map((reason) => <p key={reason}>{reason}</p>)}</section>
        <div className={styles.detailColumns}><section><h3>This recipe will</h3><ul>{details.behaviorSummary.map((item) => <li key={item}>{item}</li>)}</ul></section><section><h3>Expected playlist</h3><p>{details.expectedPlaylistShape}</p><dl><div><dt>Target</dt><dd>{details.targetTrackCount} tracks</dd></div><div><dt>Duration</dt><dd>About {details.estimatedDurationMinutes} minutes</dd></div><div><dt>Discovery</dt><dd>{discoveryLabels[details.discoveryLevel]}</dd></div><div><dt>Built-in version</dt><dd>v{details.version}</dd></div></dl></section></div>
        <section><h3>Metadata</h3><div className={styles.metadataGrid}>{details.metadataRequirements.length ? details.metadataRequirements.map((item) => <span key={`${item.id}-${item.importance}`} data-importance={item.importance}><b>{metadataLabels[item.id] || item.id}</b><small>{item.importance}</small><em>{Math.round((details.compatibility.coverage[item.id] || 0) * 100)}% library coverage</em></span>) : <span data-importance="optional"><b>No special metadata required</b><small>Common library data is sufficient</small></span>}</div><p className={styles.help}>Recommended metadata improves ranking but never makes a recipe unavailable. Required metadata is used for compatibility gating.</p></section>
        <section><h3>Important exclusions</h3><ul>{details.importantExclusions.map((item) => <li key={item}>{item}</li>)}</ul></section>
        <section><h3>Customize</h3><p className={styles.help}>The existing Mix Recipe editor will emphasize: {details.customizableFields.map((item) => item.replace(/([A-Z])/g, " $1").toLowerCase()).join(", ")}.</p></section>
        <section><h3>Update history</h3>{details.history.map((item) => <div className={styles.history} key={item.version}><b>Version {item.version}</b><span>Introduced in Mixarr v{item.appVersion}</span><p>{item.summary}</p></div>)}</section>
        {details.advancedEngineConfig != null && <details className={styles.advanced}><summary><SlidersHorizontal size={15} /> Advanced engine settings</summary><pre>{JSON.stringify(details.advancedEngineConfig, null, 2)}</pre></details>}
      </div>}
      <footer className={styles.modalFooter}><button onClick={() => updatePreference(details, "favorite", !details.preference.favorite)}><Star size={16} fill={details.preference.favorite ? "currentColor" : "none"} /> {details.preference.favorite ? "Favorited" : "Favorite"}</button><button onClick={() => install(details, true)} disabled={busyId === details.id}><SlidersHorizontal size={16} /> Customize</button><button className={styles.primary} onClick={() => details.installedRecipe ? openRecipe(details) : install(details)} disabled={busyId === details.id}>{busyId === details.id ? <Loader2 className="animate-spin" size={16} /> : <Wand2 size={16} />}{details.installedRecipe ? "Use Recipe" : "Install Recipe"}</button></footer>
    </section></div>}
  </main>;
}
