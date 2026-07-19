"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import axios from "axios";
import { AlertCircle, ArrowLeft, CheckCircle2, Copy, Loader2, Play, Save, Trash2, Wand2 } from "lucide-react";
import styles from "./recipe-detail.module.css";

const categories = ["Driving", "Workout", "Party", "Focus", "Chill", "Sleep", "Discovery", "Mood", "Decade", "Genre", "Artist", "Seasonal", "Custom"];
const sections = ["Overview", "Mood and Energy", "BPM Flow", "Discovery", "Scoring", "Artist and Album Variety", "Playlist Identity", "Refresh and Automation", "Validation", "Generated Playlists"];

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

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      axios.get(`/api/playlist-recipes/${params.id}`),
      axios.get(`/api/playlist-recipes/${params.id}/playlists`),
      axios.get("/api/plex/servers"),
    ]).then(([recipeResponse, playlistResponse, serverResponse]) => {
      if (cancelled) return;
      const loaded = recipeResponse.data.recipe as Recipe;
      setRecipe(loaded); setDraft(structuredClone(loaded)); setPlaylistName(loaded.name);
      setPlaylists(playlistResponse.data.playlists || []);
      const options = (serverResponse.data.servers || []).flatMap((server: any) => (server.libraries || []).filter((library: any) => library.type === "artist" || !library.type).map((library: any) => ({ id: library.id, serverId: server.id, label: `${server.name} — ${library.name}`, tracks: library._count?.tracks || 0 })));
      setLibraries(options);
      setLibraryId(loaded.filters?.libraryId || options[0]?.id || "");
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
      });
      setRecipe(response.data.recipe); setDraft(structuredClone(response.data.recipe)); setNotice(`Saved recipe v${response.data.recipe.recipeVersion}.`);
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

  async function duplicate() {
    if (!draft) return;
    const response = await axios.post(`/api/playlist-recipes/${draft.id}/duplicate`);
    router.push(`/recipes/${response.data.recipe.id}`);
  }

  async function remove() {
    if (!draft || !window.confirm(`Delete "${draft.name}"? ${draft.playlistCount || 0} generated playlist(s) will be retained.`)) return;
    await axios.delete(`/api/playlist-recipes/${draft.id}`);
    router.push("/recipes");
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
      <div className={styles.headerActions}><button onClick={duplicate}><Copy size={15} /> Duplicate</button><button onClick={validate} disabled={validating}>{validating ? <Loader2 className="animate-spin" size={15} /> : <CheckCircle2 size={15} />} Validate</button><button className={styles.primary} onClick={save} disabled={!dirty || saving}>{saving ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />} Save</button></div>
    </header>
    {notice && <div className={styles.notice}><CheckCircle2 size={16} /> {notice}</div>}
    {error && <div className={styles.error}><AlertCircle size={16} /> {error}</div>}
    <div className={styles.workspace}>
      <nav className={styles.tabs} aria-label="Recipe editor sections">{sections.map((section) => <button key={section} data-active={activeSection === section} onClick={() => setActiveSection(section)}>{section}</button>)}</nav>
      <section className={styles.editor}>
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
  </main>;
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) { return <div className={styles.section}><header><h3>{title}</h3><p>{hint}</p></header>{children}</div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className={styles.field}><span>{label}</span>{children}</label>; }
function NumberField({ label, value, onChange, step = "1" }: { label: string; value: any; onChange: (value: number | null) => void; step?: string }) { return <Field label={label}><input type="number" step={step} value={value ?? ""} onChange={(event) => onChange(numberOrNull(event.target.value))} /></Field>; }
function Slider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <label className={styles.slider}><span>{label}<b>{value}%</b></span><input type="range" min="0" max="100" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>; }

