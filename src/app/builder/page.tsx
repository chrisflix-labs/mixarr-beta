"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Plus, Trash2, Play, Upload, Star, Music, Shuffle, Activity, Save, RefreshCw, Pin, X, GripVertical, AlertTriangle, Clock, ListChecks, Ban } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import TrackPreviewButton from "@/components/TrackPreviewButton";
import styles from "./builder.module.css";

type Rule = {
  field: string;
  operator: string;
  value: string;
};

type RuleGroup = {
  id: string;
  combinator: "AND" | "OR";
  rules: Rule[];
};

type NegativeFilters = {
  excludeHoliday: boolean;
  excludeLive: boolean;
  excludeRemasters: boolean;
  excludeExplicit: boolean;
  excludeIntroOutro: boolean;
  minRating: string;
  excludePlayedWithinDays: string;
  minDurationMinutes: string;
  maxDurationMinutes: string;
};

type SavedRule = {
  id: string;
  name: string;
  rules: Rule[];
  ruleTree?: any;
  options?: any;
  limit: number;
  autoRefresh: boolean;
  serverId?: string | null;
  libraryId?: string | null;
  plexPlaylistId?: string | null;
  lastRefreshedAt?: string | null;
  lastRefreshStatus?: string | null;
  lastRefreshError?: string | null;
};

type PlaylistPreviewSummary = {
  targetTrackCount: number;
  matchingTrackCount: number;
  finalTrackCount: number;
  displayedTrackCount: number;
  estimatedDurationMs: number;
  estimatedDurationMinutes: number;
  bpmRange: string;
  energyRange: string;
  moodRange: string;
  popularityRange: string;
  manualExclusionsRemoved?: number;
  genreFilters: string;
  sortMode: string;
  duplicateStrategy: string;
  diversity: {
    artistCount: number;
    albumCount: number;
    repeatedArtistTracks: number;
  };
  missing: {
    bpm: number;
    audioFeatures: number;
    popularity: number;
  };
};

type PlaylistPreviewState = {
  previewId: string;
  trackIds: string[];
  totalPreviewTrackCount: number;
  summary: PlaylistPreviewSummary;
  filterSummary: Array<{ label: string; value: string }>;
  warnings: string[];
  signature: string;
};

type PlaylistRecipe = {
  id: string;
  name: string;
  description?: string | null;
  filters: any;
  filterSummary: string;
};

function formatDuration(ms?: number | null) {
  if (!ms) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatEstimatedDuration(minutes?: number | null) {
  if (!minutes) return "0 min";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${minutes} min`;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export default function BuilderPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [rules, setRules] = useState<Rule[]>([{ field: "popularity", operator: "gt", value: "50" }]);
  const [rootCombinator, setRootCombinator] = useState<"AND" | "OR">("AND");
  const [ruleGroups, setRuleGroups] = useState<RuleGroup[]>([]);
  const [limit, setLimit] = useState(50);
  const [playlistName, setPlaylistName] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [serverId, setServerId] = useState("");
  const [libraryId, setLibraryId] = useState("");
  const [duplicateStrategy, setDuplicateStrategy] = useState<"allow" | "song_artist">("song_artist");
  const [preferNonLive, setPreferNonLive] = useState(true);
  const [excludeRemasters, setExcludeRemasters] = useState(false);
  const [negativeFilters, setNegativeFilters] = useState<NegativeFilters>({
    excludeHoliday: false,
    excludeLive: false,
    excludeRemasters: false,
    excludeExplicit: false,
    excludeIntroOutro: false,
    minRating: "",
    excludePlayedWithinDays: "",
    minDurationMinutes: "",
    maxDurationMinutes: "",
  });
  const [pinnedTrackIds, setPinnedTrackIds] = useState<string[]>([]);
  const [excludedTrackIds, setExcludedTrackIds] = useState<string[]>([]);
  const [draggedTrackId, setDraggedTrackId] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [savedRules, setSavedRules] = useState<SavedRule[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [activeRecipe, setActiveRecipe] = useState<PlaylistRecipe | null>(null);
  const [isEditingRecipe, setIsEditingRecipe] = useState(false);
  const [recipeBaselineSignature, setRecipeBaselineSignature] = useState("");
  const [recipeNotice, setRecipeNotice] = useState("");
  const [showRecipeModal, setShowRecipeModal] = useState(false);
  const [recipeName, setRecipeName] = useState("");
  const [recipeDescription, setRecipeDescription] = useState("");
  const [tracks, setTracks] = useState<any[]>([]);
  const [playlistPreview, setPlaylistPreview] = useState<PlaylistPreviewState | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [exclusionNotice, setExclusionNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingRecipe, setSavingRecipe] = useState(false);
  const [updatingRecipe, setUpdatingRecipe] = useState(false);

  useEffect(() => {
    fetchSavedRules();
    fetchDefaults();
    fetchHistory();
  }, []);

  useEffect(() => {
    const sourceParams = new URLSearchParams(window.location.search);
    const source = sourceParams.get("from");
    if (!source) return;

    const genre = sourceParams.get("genre") || "";
    const q = sourceParams.get("q") || "";
    const minPopularity = sourceParams.get("minPopularity") || "";
    const trait = sourceParams.get("trait") || "";
    const importedRules: Rule[] = [];
    const importedGroups: RuleGroup[] = [];

    if (genre) importedRules.push({ field: "genre", operator: "contains", value: genre });
    if (minPopularity) importedRules.push({ field: "popularity", operator: "gte", value: minPopularity });
    if (trait === "unplayed") importedRules.push({ field: "playCount", operator: "eq", value: "0" });
    if (trait === "played") importedRules.push({ field: "playCount", operator: "gt", value: "0" });
    if (trait === "rated") importedRules.push({ field: "rating", operator: "gt", value: "0" });
    if (trait === "live") importedRules.push({ field: "isLive", operator: "eq", value: "true" });
    if (trait === "remaster") importedRules.push({ field: "isRemaster", operator: "eq", value: "true" });
    if (trait === "explicit") importedRules.push({ field: "isExplicit", operator: "eq", value: "true" });
    if (trait === "missingPopularity") importedRules.push({ field: "hasPopularity", operator: "eq", value: "false" });

    if (q) {
      importedGroups.push({
        id: "imported-search",
        combinator: "OR",
        rules: [
          { field: "title", operator: "contains", value: q },
          { field: "artist", operator: "contains", value: q },
          { field: "album", operator: "contains", value: q },
        ],
      });
    }

    if (importedRules.length === 0 && importedGroups.length === 0) return;

    setRootCombinator("AND");
    setRules(importedRules);
    setRuleGroups(importedGroups);
    setPlaylistName(genre ? `${genre} Mix` : q ? `${q} Mix` : "Filtered Library Mix");
    setSelectedRuleId("");
    setPinnedTrackIds([]);
    setExcludedTrackIds([]);
    setTracks([]);
    setPlaylistPreview(null);
  }, []);

  const fetchSavedRules = async () => {
    try {
      const res = await axios.get("/api/playlists/rules");
      setSavedRules(res.data.rules || []);
    } catch (e) {
      console.error("Failed to load saved playlists", e);
    }
  };

  const fetchDefaults = async () => {
    try {
      const res = await axios.get("/api/settings/library-selection");
      setServerId(res.data.defaultServerId || "");
      setLibraryId(res.data.defaultLibraryId || "");
    } catch (e) {
      console.error("Failed to load default library", e);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await axios.get("/api/playlists/history");
      setHistory(res.data.history || []);
    } catch (e) {
      console.error("Failed to load playlist history", e);
    }
  };

  const buildRuleTree = () => {
    const children: any[] = [];
    if (rules.length > 0) {
      children.push({ type: "group", combinator: "AND", children: rules.map(rule => ({ type: "rule", ...rule })) });
    }
    for (const group of ruleGroups) {
      children.push({ type: "group", combinator: group.combinator, children: group.rules.map(rule => ({ type: "rule", ...rule })) });
    }
    if (children.length === 0) return undefined;
    if (children.length === 1 && rootCombinator === "AND") return children[0];
    return { type: "group", combinator: rootCombinator, children };
  };

  const restoreRuleTree = (tree: any, fallbackRules: Rule[]) => {
    if (!tree) {
      setRootCombinator("AND");
      setRules(fallbackRules?.length ? fallbackRules : [{ field: "popularity", operator: "gt", value: "50" }]);
      setRuleGroups([]);
      return;
    }

    if (tree.type !== "group") {
      setRootCombinator("AND");
      setRules([{ field: tree.field, operator: tree.operator, value: tree.value }]);
      setRuleGroups([]);
      return;
    }

    setRootCombinator(tree.combinator || "AND");
    const childGroups = tree.children || [];
    const mainGroup = childGroups.find((child: any) => child.type === "group" && child.combinator === "AND") || childGroups[0];
    setRules((mainGroup?.children || []).filter((child: any) => child.type !== "group").map((child: any) => ({ field: child.field, operator: child.operator, value: child.value })));
    setRuleGroups(childGroups.filter((child: any) => child !== mainGroup && child.type === "group").map((child: any) => ({
      id: `${Date.now()}-${Math.random()}`,
      combinator: child.combinator || "OR",
      rules: (child.children || []).filter((grandchild: any) => grandchild.type !== "group").map((grandchild: any) => ({ field: grandchild.field, operator: grandchild.operator, value: grandchild.value })),
    })));
  };

  const playlistPayload = (extra: Record<string, any> = {}) => ({
    rules,
    ruleTree: buildRuleTree(),
    limit,
    serverId: serverId || undefined,
    libraryId: libraryId || undefined,
    duplicateStrategy,
    preferNonLive,
    excludeRemasters,
    negativeFilters: {
      ...negativeFilters,
      minRating: negativeFilters.minRating || undefined,
      excludePlayedWithinDays: negativeFilters.excludePlayedWithinDays || undefined,
      minDurationMinutes: negativeFilters.minDurationMinutes || undefined,
      maxDurationMinutes: negativeFilters.maxDurationMinutes || undefined,
    },
    ...extra,
  });

  const playlistPayloadFromRecipeFilters = (filters: any) => ({
    rules: filters.rules || [],
    ruleTree: filters.ruleTree,
    limit: filters.limit || 50,
    serverId: filters.serverId || undefined,
    libraryId: filters.libraryId || undefined,
    duplicateStrategy: filters.duplicateStrategy || "song_artist",
    preferNonLive: filters.preferNonLive ?? true,
    excludeRemasters: filters.excludeRemasters || false,
    negativeFilters: {
      excludeHoliday: filters.negativeFilters?.excludeHoliday || false,
      excludeLive: filters.negativeFilters?.excludeLive || false,
      excludeRemasters: filters.negativeFilters?.excludeRemasters || false,
      excludeExplicit: filters.negativeFilters?.excludeExplicit || false,
      excludeIntroOutro: filters.negativeFilters?.excludeIntroOutro || false,
      minRating: filters.negativeFilters?.minRating != null ? filters.negativeFilters.minRating.toString() : undefined,
      excludePlayedWithinDays: filters.negativeFilters?.excludePlayedWithinDays != null ? filters.negativeFilters.excludePlayedWithinDays.toString() : undefined,
      minDurationMinutes: filters.negativeFilters?.minDurationMinutes != null ? filters.negativeFilters.minDurationMinutes.toString() : undefined,
      maxDurationMinutes: filters.negativeFilters?.maxDurationMinutes != null ? filters.negativeFilters.maxDurationMinutes.toString() : undefined,
    },
    pinnedTrackIds: filters.pinnedTrackIds || [],
    excludedTrackIds: filters.excludedTrackIds || [],
  });

  const recipeEditSignature = (name: string, description: string, filters: any) => JSON.stringify({
    name: name.trim(),
    description: description.trim(),
    filters,
  });

  const previewConfigSignature = () => JSON.stringify(playlistPayload({ pinnedTrackIds: [], excludedTrackIds: [] }));
  const isPreviewCurrent = playlistPreview?.signature === previewConfigSignature();
  const createTrackIds = tracks.map((track) => track.id);
  const playlistNameReady = playlistName.trim().length > 0;
  const canCreateFromPreview = Boolean(playlistNameReady && playlistPreview && isPreviewCurrent && createTrackIds.length > 0);
  const isRecipeDirty = Boolean(
    activeRecipe
    && isEditingRecipe
    && recipeBaselineSignature
    && recipeBaselineSignature !== recipeEditSignature(recipeName, recipeDescription, playlistPayload()),
  );

  useEffect(() => {
    if (!isRecipeDirty) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "You have unsaved recipe changes. Leave without saving?";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isRecipeDirty]);

  const clearPreview = () => {
    setTracks([]);
    setPlaylistPreview(null);
    setPreviewError("");
    setExclusionNotice("");
    setPinnedTrackIds([]);
    setExcludedTrackIds([]);
  };

  const addRule = () => {
    setRules([...rules, { field: "genre", operator: "contains", value: "" }]);
    clearPreview();
  };

  const removeRule = (index: number) => {
    setRules(rules.filter((_, i) => i !== index));
    clearPreview();
  };

  const updateRule = (index: number, key: keyof Rule, val: string) => {
    const newRules = [...rules];
    newRules[index][key] = val;
    setRules(newRules);
    clearPreview();
  };

  const addGroup = () => {
    setRuleGroups([...ruleGroups, { id: `${Date.now()}-${Math.random()}`, combinator: "OR", rules: [{ field: "genre", operator: "contains", value: "" }] }]);
    clearPreview();
  };

  const updateGroup = (groupId: string, patch: Partial<RuleGroup>) => {
    setRuleGroups(ruleGroups.map(group => group.id === groupId ? { ...group, ...patch } : group));
    clearPreview();
  };

  const updateGroupRule = (groupId: string, index: number, key: keyof Rule, val: string) => {
    setRuleGroups(ruleGroups.map(group => {
      if (group.id !== groupId) return group;
      const nextRules = [...group.rules];
      nextRules[index][key] = val;
      return { ...group, rules: nextRules };
    }));
    clearPreview();
  };

  const addGroupRule = (groupId: string) => {
    setRuleGroups(ruleGroups.map(group => group.id === groupId ? { ...group, rules: [...group.rules, { field: "genre", operator: "contains", value: "" }] } : group));
    clearPreview();
  };

  const removeGroupRule = (groupId: string, index: number) => {
    setRuleGroups(ruleGroups.map(group => group.id === groupId ? { ...group, rules: group.rules.filter((_, i) => i !== index) } : group));
    clearPreview();
  };

  const loadSavedRule = (id: string) => {
    setSelectedRuleId(id);
    setActiveRecipe(null);
    setIsEditingRecipe(false);
    setRecipeBaselineSignature("");
    setRecipeNotice("");
    if (!id) return;

    const savedRule = savedRules.find(rule => rule.id === id);
    if (!savedRule) return;

    setPlaylistName(savedRule.name);
    restoreRuleTree(savedRule.ruleTree, savedRule.rules);
    setLimit(savedRule.limit);
    setAutoRefresh(savedRule.autoRefresh);
    setServerId(savedRule.serverId || "");
    setLibraryId(savedRule.libraryId || "");
    setDuplicateStrategy(savedRule.options?.duplicateStrategy || "song_artist");
    setPreferNonLive(savedRule.options?.preferNonLive ?? true);
    setExcludeRemasters(savedRule.options?.excludeRemasters || false);
    setNegativeFilters({
      excludeHoliday: savedRule.options?.negativeFilters?.excludeHoliday || false,
      excludeLive: savedRule.options?.negativeFilters?.excludeLive || false,
      excludeRemasters: savedRule.options?.negativeFilters?.excludeRemasters || false,
      excludeExplicit: savedRule.options?.negativeFilters?.excludeExplicit || false,
      excludeIntroOutro: savedRule.options?.negativeFilters?.excludeIntroOutro || false,
      minRating: savedRule.options?.negativeFilters?.minRating?.toString() || "",
      excludePlayedWithinDays: savedRule.options?.negativeFilters?.excludePlayedWithinDays?.toString() || "",
      minDurationMinutes: savedRule.options?.negativeFilters?.minDurationMinutes?.toString() || "",
      maxDurationMinutes: savedRule.options?.negativeFilters?.maxDurationMinutes?.toString() || "",
    });
    setPinnedTrackIds([]);
    setExcludedTrackIds([]);
    setTracks([]);
    setPlaylistPreview(null);
  };

  const applyRecipeFilters = async (recipe: PlaylistRecipe, shouldPreview = false, editMode = false) => {
    const filters = recipe.filters || {};
    const payload = playlistPayloadFromRecipeFilters(filters);

    setActiveRecipe(recipe);
    setIsEditingRecipe(editMode);
    setRecipeName(recipe.name);
    setRecipeDescription(recipe.description || "");
    setRecipeBaselineSignature(recipeEditSignature(recipe.name, recipe.description || "", payload));
    setRecipeNotice(`Editing recipe: ${recipe.name}`);
    setSelectedRuleId("");
    setPlaylistName(recipe.name);
    restoreRuleTree(filters.ruleTree, filters.rules || []);
    setLimit(filters.limit || 50);
    setAutoRefresh(false);
    setServerId(filters.serverId || "");
    setLibraryId(filters.libraryId || "");
    setDuplicateStrategy(filters.duplicateStrategy || "song_artist");
    setPreferNonLive(filters.preferNonLive ?? true);
    setExcludeRemasters(filters.excludeRemasters || false);
    setNegativeFilters({
      excludeHoliday: filters.negativeFilters?.excludeHoliday || false,
      excludeLive: filters.negativeFilters?.excludeLive || false,
      excludeRemasters: filters.negativeFilters?.excludeRemasters || false,
      excludeExplicit: filters.negativeFilters?.excludeExplicit || false,
      excludeIntroOutro: filters.negativeFilters?.excludeIntroOutro || false,
      minRating: filters.negativeFilters?.minRating?.toString() || "",
      excludePlayedWithinDays: filters.negativeFilters?.excludePlayedWithinDays?.toString() || "",
      minDurationMinutes: filters.negativeFilters?.minDurationMinutes?.toString() || "",
      maxDurationMinutes: filters.negativeFilters?.maxDurationMinutes?.toString() || "",
    });
    setPinnedTrackIds(filters.pinnedTrackIds || []);
    setExcludedTrackIds(filters.excludedTrackIds || []);
    setTracks([]);
    setPlaylistPreview(null);

    if (shouldPreview) {
      await runPreview(payload, JSON.stringify(payload), editMode ? null : recipe);
    }
  };

  useEffect(() => {
    const recipeId = searchParams.get("recipeId");
    if (!recipeId) return;

    let cancelled = false;
    const loadRecipe = async () => {
      try {
        const res = await axios.get(`/api/playlist-recipes/${recipeId}`);
        if (cancelled) return;
        await applyRecipeFilters(res.data.recipe, searchParams.get("preview") === "1", searchParams.get("edit") === "1");
      } catch (e) {
        console.error("Failed to load playlist recipe", e);
        if (!cancelled) setRecipeNotice("Unable to load that playlist recipe.");
      }
    };

    loadRecipe();
    return () => {
      cancelled = true;
    };
    // Load only when the URL-selected recipe changes; filter state changes should not reload it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const saveSmartPlaylist = async (showAlert = true) => {
    if (!playlistName.trim()) {
      alert("Please enter a playlist name");
      return "";
    }

    setSaving(true);
    try {
      const payload = { name: playlistName, autoRefresh, ...playlistPayload() };
      const res = selectedRuleId
        ? await axios.put(`/api/playlists/rules/${selectedRuleId}`, payload)
        : await axios.post("/api/playlists/rules", payload);

      setSelectedRuleId(res.data.rule.id);
      await fetchSavedRules();
      if (showAlert) alert("Smart playlist saved");
      return res.data.rule.id;
    } catch (e) {
      console.error(e);
      alert("Failed to save smart playlist");
      return "";
    } finally {
      setSaving(false);
    }
  };

  const openRecipeModal = () => {
    setRecipeName((recipeName || playlistName || activeRecipe?.name || "").trim());
    setRecipeDescription(recipeDescription || activeRecipe?.description || "");
    setShowRecipeModal(true);
  };

  const savePlaylistRecipe = async () => {
    if (!recipeName.trim()) {
      alert("Recipe name is required.");
      return;
    }

    setSavingRecipe(true);
    try {
      const res = await axios.post("/api/playlist-recipes", {
        name: recipeName,
        description: recipeDescription,
        filters: playlistPayload(),
      });
      setActiveRecipe(res.data.recipe);
      setIsEditingRecipe(false);
      setRecipeName(res.data.recipe.name);
      setRecipeDescription(res.data.recipe.description || "");
      setRecipeNotice(`Saved recipe "${res.data.recipe.name}".`);
      setShowRecipeModal(false);
    } catch (e: any) {
      console.error(e);
      alert(e.response?.data?.error || "Failed to save playlist recipe");
    } finally {
      setSavingRecipe(false);
    }
  };

  const updatePlaylistRecipe = async () => {
    if (!activeRecipe) return;
    if (!recipeName.trim()) {
      alert("Recipe name is required.");
      return;
    }

    setUpdatingRecipe(true);
    try {
      const res = await axios.patch(`/api/playlist-recipes/${activeRecipe.id}`, {
        name: recipeName,
        description: recipeDescription,
        filters: playlistPayload(),
      });
      setActiveRecipe(res.data.recipe);
      setIsEditingRecipe(true);
      setRecipeName(res.data.recipe.name);
      setRecipeDescription(res.data.recipe.description || "");
      setRecipeBaselineSignature(recipeEditSignature(res.data.recipe.name, res.data.recipe.description || "", res.data.recipe.filters));
      setRecipeNotice(`Updated recipe "${res.data.recipe.name}".`);
    } catch (e: any) {
      console.error(e);
      alert(e.response?.data?.error || "Failed to update playlist recipe");
    } finally {
      setUpdatingRecipe(false);
    }
  };

  const refreshSelectedPlaylist = async () => {
    if (!selectedRuleId) return;

    setSaving(true);
    try {
      await axios.post(`/api/playlists/rules/${selectedRuleId}/refresh`);
      await fetchSavedRules();
      alert("Smart playlist refreshed in Plex");
    } catch (e) {
      console.error(e);
      alert("Export this saved playlist once before refreshing it");
    } finally {
      setSaving(false);
    }
  };

  const applyTemplate = (templateName: string) => {
    setActiveRecipe(null);
    setIsEditingRecipe(false);
    setRecipeBaselineSignature("");
    setRecipeNotice("");
    if (templateName === "deep_cuts") {
      setRules([{ field: "popularity", operator: "lt", value: "30" }]);
      setPlaylistName("Deep Cuts Discovered");
    } else if (templateName === "90s") {
      setRules([
        { field: "year", operator: "gte", value: "1990" },
        { field: "year", operator: "lte", value: "1999" }
      ]);
      setPlaylistName("Ultimate 90s Mix");
    } else if (templateName === "christmas") {
      setRules([
        { field: "title", operator: "contains", value: "Christmas" }
      ]);
      setPlaylistName("Christmas Cheer");
    } else if (templateName === "anti_christmas") {
      setRules([
        { field: "title", operator: "not_contains", value: "Christmas" },
        { field: "title", operator: "not_contains", value: "Holiday" }
      ]);
      setNegativeFilters({ ...negativeFilters, excludeHoliday: true });
      setPlaylistName("No Holidays Allowed");
    } else if (templateName === "workout") {
      setRules([
        { field: "tempo", operator: "gte", value: "120" },
        { field: "energy", operator: "gte", value: "0.7" }
      ]);
      setPlaylistName("High BPM Workout Mix");
    }
    setSelectedRuleId("");
    setRuleGroups([]);
    setPinnedTrackIds([]);
    setExcludedTrackIds([]);
    setTracks([]);
    setPlaylistPreview(null);
  };

  const runPreview = async (config = playlistPayload(), signature = previewConfigSignature(), recipeForUsage: PlaylistRecipe | null = isEditingRecipe ? null : activeRecipe) => {
    setLoading(true);
    setPreviewError("");
    setExclusionNotice("");
    try {
      setPinnedTrackIds([]);
      setExcludedTrackIds([]);
      const res = await axios.post("/api/playlists/preview", config);
      setTracks(res.data.tracks || []);
      setPlaylistPreview({
        previewId: res.data.previewId,
        trackIds: res.data.trackIds || [],
        totalPreviewTrackCount: res.data.totalPreviewTrackCount || 0,
        summary: res.data.summary,
        filterSummary: res.data.filterSummary || [],
        warnings: res.data.warnings || [],
        signature,
      });
      if (recipeForUsage?.id) {
        await axios.post(`/api/playlist-recipes/${recipeForUsage.id}/use`);
      }
    } catch (e) {
      console.error(e);
      setPreviewError("Unable to generate playlist preview. Check your filters and try again.");
    } finally {
      setLoading(false);
    }
  };

  const previewPlaylist = async () => runPreview();

  const cancelRecipeEditing = () => {
    if (isRecipeDirty && !window.confirm("You have unsaved recipe changes. Leave without saving?")) return;
    router.push("/recipes");
  };

  const regenerateUnpinned = async () => {
    setLoading(true);
    setPreviewError("");
    setExclusionNotice("");
    try {
      const signature = previewConfigSignature();
      const res = await axios.post("/api/playlists/preview", playlistPayload({
        pinnedTrackIds,
        excludedTrackIds,
      }));
      setTracks(res.data.tracks || []);
      setPlaylistPreview({
        previewId: res.data.previewId,
        trackIds: res.data.trackIds || [],
        totalPreviewTrackCount: res.data.totalPreviewTrackCount || 0,
        summary: res.data.summary,
        filterSummary: res.data.filterSummary || [],
        warnings: res.data.warnings || [],
        signature,
      });
      setPinnedTrackIds((res.data.trackIds || []).filter((trackId: string) => pinnedTrackIds.includes(trackId)));
    } catch (e) {
      console.error(e);
      setPreviewError("Unable to generate playlist preview. Check your filters and try again.");
    } finally {
      setLoading(false);
    }
  };

  const removeTrack = (trackId: string) => {
    setTracks(tracks.filter(track => track.id !== trackId));
    setPlaylistPreview(playlistPreview ? {
      ...playlistPreview,
      trackIds: playlistPreview.trackIds.filter(id => id !== trackId),
      totalPreviewTrackCount: Math.max(0, playlistPreview.totalPreviewTrackCount - 1),
      summary: {
        ...playlistPreview.summary,
        finalTrackCount: Math.max(0, playlistPreview.summary.finalTrackCount - 1),
      },
    } : null);
    setPinnedTrackIds(pinnedTrackIds.filter(id => id !== trackId));
    setExcludedTrackIds([...excludedTrackIds, trackId]);
  };

  const excludeTrack = async (track: any) => {
    const title = track.title || "this track";
    if (!window.confirm(`Exclude "${title}" from future Mixarr playlists?`)) return;

    try {
      await axios.post("/api/track-exclusions", {
        trackId: track.id,
        reason: "Do not want in playlists",
      });
      setTracks((current) => current.filter((item) => item.id !== track.id));
      setPlaylistPreview((current) => current ? {
        ...current,
        trackIds: current.trackIds.filter((id) => id !== track.id),
        totalPreviewTrackCount: Math.max(0, current.totalPreviewTrackCount - 1),
        summary: {
          ...current.summary,
          matchingTrackCount: Math.max(0, current.summary.matchingTrackCount - 1),
          finalTrackCount: Math.max(0, current.summary.finalTrackCount - 1),
          displayedTrackCount: Math.max(0, current.summary.displayedTrackCount - 1),
          manualExclusionsRemoved: (current.summary.manualExclusionsRemoved || 0) + 1,
        },
        filterSummary: [
          ...current.filterSummary.filter((item) => item.label !== "Manual exclusions"),
          { label: "Manual exclusions", value: `${(current.summary.manualExclusionsRemoved || 0) + 1} removed` },
        ],
      } : null);
      setPinnedTrackIds((current) => current.filter((id) => id !== track.id));
      setExcludedTrackIds((current) => current.filter((id) => id !== track.id));
      setExclusionNotice(`Excluded "${title}" from future Mixarr playlists.`);
    } catch (error: any) {
      console.error("Failed to exclude track", error);
      alert(error.response?.data?.error || "Could not exclude track");
    }
  };

  const togglePin = (trackId: string) => {
    setPinnedTrackIds(pinnedTrackIds.includes(trackId)
      ? pinnedTrackIds.filter(id => id !== trackId)
      : [...pinnedTrackIds, trackId]);
  };

  const moveDraggedTrack = (targetTrackId: string) => {
    if (!draggedTrackId || draggedTrackId === targetTrackId) return;
    const draggedIndex = tracks.findIndex(track => track.id === draggedTrackId);
    const targetIndex = tracks.findIndex(track => track.id === targetTrackId);
    if (draggedIndex === -1 || targetIndex === -1) return;

    const nextTracks = [...tracks];
    const [draggedTrack] = nextTracks.splice(draggedIndex, 1);
    nextTracks.splice(targetIndex, 0, draggedTrack);
    setTracks(nextTracks);
    if (playlistPreview) setPlaylistPreview({ ...playlistPreview, trackIds: nextTracks.map(track => track.id) });
    setPinnedTrackIds(nextTracks.filter(track => pinnedTrackIds.includes(track.id)).map(track => track.id));
    setDraggedTrackId("");
  };

  const exportToPlex = async () => {
    if (!playlistName) {
      alert("Please enter a playlist name");
      return;
    }
    if (!playlistPreview || !isPreviewCurrent) {
      alert("Preview this playlist recipe before creating it");
      return;
    }
    if (playlistPreview.trackIds.length === 0) {
      alert("No tracks matched this playlist recipe. Adjust your filters and preview again.");
      return;
    }
    setExporting(true);
    try {
      const savedRuleId = autoRefresh || selectedRuleId
        ? await saveSmartPlaylist(false)
        : "";
      if ((autoRefresh || selectedRuleId) && !savedRuleId) return;

      await axios.post("/api/playlists/create-from-preview", {
        name: playlistName,
        trackIds: createTrackIds,
        savedRuleId: savedRuleId || undefined,
        rulesSnapshot: buildRuleTree() || rules,
        optionsSnapshot: playlistPayload({ pinnedTrackIds: [], excludedTrackIds: [] }),
        previewId: playlistPreview.previewId,
        recipeId: activeRecipe?.id || undefined,
        recipeName: activeRecipe?.name || undefined,
        filters: activeRecipe ? playlistPayload({ pinnedTrackIds: [], excludedTrackIds: [] }) : undefined,
        manualExclusionsApplied: playlistPreview.summary.manualExclusionsRemoved || 0,
      });
      await fetchSavedRules();
      await fetchHistory();
      alert("Playlist created in Plex successfully!");
    } catch (e) {
      console.error(e);
      alert("Failed to create playlist in Plex");
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
    <div className="builder-container">
      {/* LEFT COLUMN: BUILDER */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        <header className={styles.header}>
          <h2>Playlist Builder</h2>
          <p>Create dynamic mixes using cached metadata</p>
        </header>

        {recipeNotice && (
          <div className={styles.recipeNotice}>
            <span>{recipeNotice}</span>
            <button type="button" onClick={() => setRecipeNotice("")} className={styles.btnIcon} aria-label="Dismiss recipe message">
              <X size={14} />
            </button>
          </div>
        )}

        {activeRecipe && (
          <div className={`glass-panel ${styles.recipeEditPanel}`}>
            <div className={styles.recipeEditHeader}>
              <div>
                <h3>{isEditingRecipe ? "Edit Playlist Recipe" : "Recipe Loaded"}</h3>
                <p>{isEditingRecipe ? "Update the saved recipe details and current builder filters." : `Editing recipe: ${activeRecipe.name}`}</p>
              </div>
              <div className={styles.recipeEditActions}>
                <button type="button" onClick={previewPlaylist} disabled={loading} className={styles.btnSecondary}>
                  <Play size={16} />
                  Preview Recipe
                </button>
                <button type="button" onClick={openRecipeModal} disabled={savingRecipe} className={styles.btnSecondary}>
                  {savingRecipe ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
                  Save as New Recipe
                </button>
                <button type="button" onClick={updatePlaylistRecipe} disabled={updatingRecipe} className={styles.btnPrimary}>
                  {updatingRecipe ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
                  Update Recipe
                </button>
                {isEditingRecipe && (
                  <button type="button" onClick={cancelRecipeEditing} className={styles.btnSecondary}>
                    Cancel
                  </button>
                )}
              </div>
            </div>
            <div className={styles.recipeEditFields}>
              <label className={styles.optionLabel}>
                Recipe name
                <input value={recipeName} onChange={(e) => setRecipeName(e.target.value)} className={styles.input} />
              </label>
              <label className={styles.optionLabel}>
                Description, optional
                <textarea value={recipeDescription} onChange={(e) => setRecipeDescription(e.target.value)} className={styles.textarea} rows={3} />
              </label>
            </div>
          </div>
        )}

        {/* Saved Smart Playlists */}
        <div className={`glass-panel ${styles.panel}`}>
          <h3>Saved Smart Playlists</h3>
          <div className={styles.savedBar}>
            <select value={selectedRuleId} onChange={(e) => loadSavedRule(e.target.value)} className={styles.savedBarSelect}>
              <option value="">New smart playlist</option>
              {savedRules.map(rule => (
                <option key={rule.id} value={rule.id}>
                  {rule.name}{rule.autoRefresh ? " (auto)" : ""}
                </option>
              ))}
            </select>
            <label className={styles.savedCheck}>
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              Auto-refresh after export
            </label>
            <button onClick={() => saveSmartPlaylist()} disabled={saving} className={styles.btnSecondary}>
              {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
              {selectedRuleId ? "Update" : "Save"}
            </button>
            <button onClick={openRecipeModal} disabled={savingRecipe} className={styles.btnSecondary}>
              {savingRecipe ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
              {activeRecipe ? "Save as New Recipe" : "Save Recipe"}
            </button>
            {activeRecipe && (
              <button onClick={updatePlaylistRecipe} disabled={updatingRecipe} className={styles.btnSecondary}>
                {updatingRecipe ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
                Update Recipe
              </button>
            )}
            {selectedRuleId && (
              <button onClick={refreshSelectedPlaylist} disabled={saving} className={styles.btnSecondary}>
                <RefreshCw size={16} />
                Refresh Plex
              </button>
            )}
          </div>
          {selectedRuleId && savedRules.find(rule => rule.id === selectedRuleId)?.lastRefreshedAt && (
            <p className={styles.savedTimestamp}>
              Last Plex refresh: {new Date(savedRules.find(rule => rule.id === selectedRuleId)!.lastRefreshedAt!).toLocaleString()}
            </p>
          )}
        </div>

        {/* Quick Templates */}
        <div className={`glass-panel ${styles.panel}`}>
          <h3>Quick Templates</h3>
          <div className={styles.templateRow}>
            <button onClick={() => applyTemplate("deep_cuts")} className={styles.btnTemplate}><Shuffle size={14} /> Deep Cuts</button>
            <button onClick={() => applyTemplate("90s")} className={styles.btnTemplate}><Music size={14} /> 90s Decade</button>
            <button onClick={() => applyTemplate("workout")} className={styles.btnTemplate}><Activity size={14} /> Workout (High BPM)</button>
            <button onClick={() => applyTemplate("christmas")} className={styles.btnTemplate}><Star size={14} /> Seasonal</button>
            <button onClick={() => applyTemplate("anti_christmas")} className={styles.btnTemplate}>Anti-Seasonal</button>
          </div>
        </div>

        {/* Playlist Behavior */}
        <div className={`glass-panel ${styles.panel}`}>
          <h3>Playlist Behavior</h3>
          <div className={styles.behaviorGrid}>
            <div className={styles.behaviorRow}>
              <label className={styles.optionLabel}>
                Duplicate Control
                <select value={duplicateStrategy} onChange={(e) => { setDuplicateStrategy(e.target.value as "allow" | "song_artist"); clearPreview(); }} className={styles.select}>
                  <option value="song_artist">One version per song</option>
                  <option value="allow">Allow duplicates</option>
                </select>
              </label>
              <label className={styles.optionLabel}>
                Top-Level Groups
                <select value={rootCombinator} onChange={(e) => { setRootCombinator(e.target.value as "AND" | "OR"); clearPreview(); }} className={styles.select}>
                  <option value="AND">Match all groups</option>
                  <option value="OR">Match any group</option>
                </select>
              </label>
            </div>
            <div className={styles.checkGroup}>
              <label className={styles.checkLabel}><input type="checkbox" checked={preferNonLive} onChange={(e) => { setPreferNonLive(e.target.checked); clearPreview(); }} /> Prefer non-live duplicates</label>
              <label className={styles.checkLabel}><input type="checkbox" checked={excludeRemasters} onChange={(e) => { setExcludeRemasters(e.target.checked); clearPreview(); }} /> Exclude remasters</label>
              <label className={styles.checkLabel}><input type="checkbox" checked={negativeFilters.excludeHoliday} onChange={(e) => { setNegativeFilters({ ...negativeFilters, excludeHoliday: e.target.checked }); clearPreview(); }} /> Exclude holiday tracks</label>
              <label className={styles.checkLabel}><input type="checkbox" checked={negativeFilters.excludeLive} onChange={(e) => { setNegativeFilters({ ...negativeFilters, excludeLive: e.target.checked }); clearPreview(); }} /> Exclude live tracks</label>
              <label className={styles.checkLabel}><input type="checkbox" checked={negativeFilters.excludeExplicit} onChange={(e) => { setNegativeFilters({ ...negativeFilters, excludeExplicit: e.target.checked }); clearPreview(); }} /> Exclude explicit tracks</label>
              <label className={styles.checkLabel}><input type="checkbox" checked={negativeFilters.excludeIntroOutro} onChange={(e) => { setNegativeFilters({ ...negativeFilters, excludeIntroOutro: e.target.checked }); clearPreview(); }} /> Exclude intros/outros</label>
            </div>
            <div className={styles.behaviorRow}>
              <label className={styles.optionLabel}>Min Rating<input value={negativeFilters.minRating} onChange={(e) => { setNegativeFilters({ ...negativeFilters, minRating: e.target.value }); clearPreview(); }} placeholder="0-10" className={styles.input} /></label>
              <label className={styles.optionLabel}>Not Played Days<input value={negativeFilters.excludePlayedWithinDays} onChange={(e) => { setNegativeFilters({ ...negativeFilters, excludePlayedWithinDays: e.target.value }); clearPreview(); }} placeholder="30" className={styles.input} /></label>
              <label className={styles.optionLabel}>Min Minutes<input value={negativeFilters.minDurationMinutes} onChange={(e) => { setNegativeFilters({ ...negativeFilters, minDurationMinutes: e.target.value }); clearPreview(); }} placeholder="1" className={styles.input} /></label>
              <label className={styles.optionLabel}>Max Minutes<input value={negativeFilters.maxDurationMinutes} onChange={(e) => { setNegativeFilters({ ...negativeFilters, maxDurationMinutes: e.target.value }); clearPreview(); }} placeholder="8" className={styles.input} /></label>
            </div>
          </div>
        </div>

        {/* Rule Builder */}
        <div className={`glass-panel ${styles.rulePanel}`}>
          <div className={styles.ruleHeader}>
            <div>
              <h3>Matching Rules</h3>
              <p className={styles.panelSubtext}>
                <strong>Cheat Sheet:</strong> Happy (Energy: 0.7, Mood: 0.9) | Relaxed (E: 0.2, M: 0.6) | Aggressive (E: 0.9, M: 0.3) | Sad (E: 0.3, M: 0.2)
              </p>
            </div>
            <div className={styles.ruleHeaderActions}>
              <button onClick={addRule} className={styles.btnGhost}>
                <Plus size={16} /> Add Rule
              </button>
              <button onClick={addGroup} className={styles.btnGhost}>
                <Plus size={16} /> Add OR Group
              </button>
            </div>
          </div>

          <div className={styles.ruleList}>
            {rules.map((rule, i) => (
              <div key={i} className={styles.ruleRow}>
                <select
                  value={rule.field}
                  onChange={(e) => updateRule(i, "field", e.target.value)}
                  className={styles.select}
                >
                  <option value="popularity">Popularity Score (0-100)</option>
                  <option value="energy">Energy (0.0-1.0)</option>
                  <option value="valence">Mood/Valence (0.0-1.0)</option>
                  <option value="tempo">BPM (Beats Per Minute) / Tempo</option>
                  <option value="year">Release Year</option>
                  <option value="duration">Duration (ms)</option>
                  <option value="rating">Plex Rating</option>
                  <option value="playCount">Play Count</option>
                  <option value="isLive">Live Track</option>
                  <option value="isRemaster">Remaster</option>
                  <option value="isExplicit">Explicit</option>
                  <option value="hasPopularity">Has Popularity Score</option>
                  <option value="genre">Genre Tag</option>
                  <option value="artist">Artist Name</option>
                  <option value="album">Album Title</option>
                  <option value="title">Track Title</option>
                </select>

                <select
                  value={rule.operator}
                  onChange={(e) => updateRule(i, "operator", e.target.value)}
                  className={styles.select}
                >
                  <option value="eq">Equals (=)</option>
                  <option value="contains">Contains</option>
                  <option value="not_contains">Does Not Contain</option>
                  <option value="gt">Greater Than (&gt;)</option>
                  <option value="lt">Less Than (&lt;)</option>
                  <option value="gte">Greater or Equal (&ge;)</option>
                  <option value="lte">Less or Equal (&le;)</option>
                </select>

                <input
                  type="text"
                  value={rule.value}
                  onChange={(e) => updateRule(i, "value", e.target.value)}
                  placeholder="Value..."
                  className={styles.input}
                  style={{ flex: 1 }}
                />

                <button onClick={() => removeRule(i)} className={styles.btnGhostDanger}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {ruleGroups.map((group) => (
              <div key={group.id} className={styles.ruleGroupBox}>
                <div className={styles.ruleGroupHeader}>
                  <select value={group.combinator} onChange={(e) => updateGroup(group.id, { combinator: e.target.value as "AND" | "OR" })} className={styles.select}>
                    <option value="OR">Any rule in this group</option>
                    <option value="AND">All rules in this group</option>
                  </select>
                  <button onClick={() => { setRuleGroups(ruleGroups.filter(item => item.id !== group.id)); clearPreview(); }} className={styles.btnGhostDanger}>
                    <Trash2 size={16} />
                  </button>
                </div>
                {group.rules.map((rule, i) => (
                  <div key={i} className={styles.ruleRow}>
                    <select value={rule.field} onChange={(e) => updateGroupRule(group.id, i, "field", e.target.value)} className={styles.select}>
                      <option value="popularity">Popularity Score (0-100)</option>
                      <option value="energy">Energy (0.0-1.0)</option>
                      <option value="valence">Mood/Valence (0.0-1.0)</option>
                      <option value="tempo">BPM / Tempo</option>
                      <option value="year">Release Year</option>
                      <option value="duration">Duration (ms)</option>
                      <option value="rating">Plex Rating</option>
                      <option value="playCount">Play Count</option>
                      <option value="isLive">Live Track</option>
                      <option value="isRemaster">Remaster</option>
                      <option value="isExplicit">Explicit</option>
                      <option value="hasPopularity">Has Popularity Score</option>
                      <option value="genre">Genre Tag</option>
                      <option value="artist">Artist Name</option>
                      <option value="album">Album Title</option>
                      <option value="title">Track Title</option>
                    </select>
                    <select value={rule.operator} onChange={(e) => updateGroupRule(group.id, i, "operator", e.target.value)} className={styles.select}>
                      <option value="eq">Equals (=)</option>
                      <option value="contains">Contains</option>
                      <option value="not_contains">Does Not Contain</option>
                      <option value="gt">Greater Than (&gt;)</option>
                      <option value="lt">Less Than (&lt;)</option>
                      <option value="gte">Greater or Equal (&ge;)</option>
                      <option value="lte">Less or Equal (&le;)</option>
                    </select>
                    <input type="text" value={rule.value} onChange={(e) => updateGroupRule(group.id, i, "value", e.target.value)} placeholder="Value..." className={styles.input} style={{ flex: 1 }} />
                    <button onClick={() => removeGroupRule(group.id, i)} className={styles.btnGhostDanger}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <button onClick={() => addGroupRule(group.id)} className={styles.btnGhost}>
                  <Plus size={16} /> Add Group Rule
                </button>
              </div>
            ))}
          </div>

          <div className={styles.ruleFooter}>
            <div className={styles.limitLabel}>
              <label>Track Limit:</label>
              <input type="number" value={limit} onChange={(e) => { setLimit(Number(e.target.value)); clearPreview(); }} className={styles.limitInput} />
            </div>
            <button onClick={previewPlaylist} disabled={loading} className={styles.btnPrimary} style={{ marginLeft: "auto" }}>
              <Play size={16} /> {loading ? "Querying..." : "Preview Playlist"}
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: PREVIEW */}
      <div className={`glass-panel ${styles.previewPanel}`}>
        <div className={styles.previewHeader}>
          <div>
            <h3>Playlist Preview</h3>
            <p>Review the exact playlist order before Mixarr writes to Plex.</p>
          </div>
          <div className={styles.previewActions}>
            <button onClick={previewPlaylist} disabled={loading} className={styles.btnSecondary}>
              <Play size={14} /> Preview Playlist
            </button>
            <button onClick={regenerateUnpinned} disabled={loading || !playlistPreview} className={styles.btnSecondary}>
              <RefreshCw size={14} /> Refresh Preview
            </button>
          </div>
        </div>

        <div className={styles.previewNameRow}>
          <input
            type="text"
            placeholder="Name your playlist..."
            value={playlistName}
            onChange={(e) => setPlaylistName(e.target.value)}
            className={styles.previewNameInput}
          />
          <button onClick={exportToPlex} disabled={exporting || !canCreateFromPreview} className={styles.btnPrimary}>
            <Upload size={16} /> {exporting ? "Creating..." : "Create Playlist"}
          </button>
        </div>
        {!playlistNameReady && (
          <p className={styles.helperText}>Enter a playlist name before creating the playlist.</p>
        )}
        <p className={styles.helperText}>Refresh Preview reruns the current filters.</p>

        {playlistPreview && !isPreviewCurrent && (
          <div className={styles.staleNotice}>
            <AlertTriangle size={16} />
            Filters changed after this preview. Refresh the preview before creating the playlist.
          </div>
        )}

        {exclusionNotice && (
          <div className={styles.exclusionNotice}>
            <Ban size={16} />
            {exclusionNotice}
          </div>
        )}

        {playlistPreview && (
          <>
            <div className={styles.statsGrid}>
              <div className={styles.statCard}>
                <span>Target</span>
                <strong>{playlistPreview.summary.targetTrackCount}</strong>
              </div>
              <div className={styles.statCard}>
                <span>Matched</span>
                <strong>{playlistPreview.summary.matchingTrackCount}</strong>
              </div>
              <div className={styles.statCard}>
                <span>Preview</span>
                <strong>{playlistPreview.summary.finalTrackCount}</strong>
              </div>
              <div className={styles.statCard}>
                <span>Duration</span>
                <strong>{formatEstimatedDuration(playlistPreview.summary.estimatedDurationMinutes)}</strong>
              </div>
              {(playlistPreview.summary.manualExclusionsRemoved || 0) > 0 && (
                <div className={styles.statCard}>
                  <span>Manual exclusions</span>
                  <strong>{playlistPreview.summary.manualExclusionsRemoved} removed</strong>
                </div>
              )}
            </div>

            {(playlistPreview.summary.manualExclusionsRemoved || 0) > 0 && (
              <p className={styles.manualExclusionText}>
                {playlistPreview.summary.manualExclusionsRemoved} manually excluded track{playlistPreview.summary.manualExclusionsRemoved === 1 ? " was" : "s were"} removed from this preview.
              </p>
            )}

            {playlistPreview.warnings.length > 0 && (
              <div className={styles.warningPanel}>
                <div className={styles.warningTitle}>
                  <AlertTriangle size={16} />
                  Warnings
                </div>
                {playlistPreview.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            )}
          </>
        )}

        <section className={styles.trackPreviewSection} aria-labelledby="previewed-tracks">
          <div className={styles.trackPreviewHeader}>
            <div>
              <h4 id="previewed-tracks">Previewed Tracks</h4>
              <p>These are the tracks Mixarr will add to Plex in this order.</p>
            </div>
            {playlistPreview && tracks.length > 0 && (
              <span className={styles.trackPreviewCount}>
                {playlistPreview.totalPreviewTrackCount > tracks.length
                  ? `Showing first ${tracks.length} of ${playlistPreview.totalPreviewTrackCount} matched tracks. Create Playlist will use these ${tracks.length} previewed tracks.`
                  : `Showing ${tracks.length} previewed tracks. Create Playlist will use these exact tracks.`}
              </span>
            )}
          </div>

          {loading ? (
            <div className={styles.loadingPreview}>Generating playlist preview...</div>
          ) : previewError ? (
            <div className={styles.errorPreview}>{previewError}</div>
          ) : tracks.length === 0 ? (
            <div className={styles.emptyPreview}>
              {playlistPreview?.totalPreviewTrackCount === 0
                ? "No tracks matched this playlist preview. Adjust your filters and try again."
                : "Click Preview Playlist to see matched tracks before creating anything in Plex."}
            </div>
          ) : (
            <>
              <div className={`table-container ${styles.trackTableWrap}`}>
                <table className={styles.previewTable}>
                  <thead>
                    <tr>
                      <th className={styles.colIndex}>#</th>
                      <th>Track title</th>
                      <th>Artist</th>
                      <th>Album</th>
                      <th className={styles.colDuration}>Duration</th>
                      <th className={styles.colBpm}>BPM</th>
                      <th className={styles.colFeature}>Energy</th>
                      <th className={styles.colFeature}>Mood</th>
                      <th className={styles.colPop}>Popularity</th>
                      <th className={styles.colActions}>Tools</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tracks.map((track, idx) => (
                      <tr
                        key={track.id}
                        draggable
                        onDragStart={() => setDraggedTrackId(track.id)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => moveDraggedTrack(track.id)}
                      >
                        <td className={styles.trackOrder}>{idx + 1}</td>
                        <td className={styles.trackTitle}>
                          {track.title || "—"}
                          {(track.isLive || track.isRemaster || track.isExplicit) && (
                            <div className={styles.badgeRow}>
                              {track.isLive && <span className={styles.miniBadge}>Live</span>}
                              {track.isRemaster && <span className={styles.miniBadge}>Remaster</span>}
                              {track.isExplicit && <span className={styles.miniBadge}>Explicit</span>}
                            </div>
                          )}
                        </td>
                        <td className={styles.trackArtist}>{track.artist?.title || "—"}</td>
                        <td className={styles.trackAlbum}>{track.album?.title || "—"}</td>
                        <td className={styles.trackDuration}>{formatDuration(track.duration)}</td>
                        <td className={styles.trackBpm}>
                          {(track.effectiveBpm ?? track.bpm ?? track.audioFeature?.tempo)?.toFixed(0) || "—"}
                          {track.metadataConfidence?.audio?.tempoLabel && <div className={styles.trackBpmLabel}>{track.metadataConfidence.audio.tempoLabel}</div>}
                        </td>
                        <td className={styles.trackFeature}>{(track.audioFeature?.effectiveEnergy ?? track.audioFeature?.energy)?.toFixed(2) || "—"}</td>
                        <td className={styles.trackFeature}>{(track.audioFeature?.effectiveMood ?? track.audioFeature?.valence)?.toFixed(2) || "—"}</td>
                        <td className={styles.trackPop}>{track.popularity?.score?.toFixed(0) || "—"}</td>
                        <td>
                          <div className={styles.actionGroup}>
                            <button title="Drag row" className={styles.btnIcon}><GripVertical size={14} /></button>
                            <button title={pinnedTrackIds.includes(track.id) ? "Unpin" : "Pin"} onClick={() => togglePin(track.id)} className={`${styles.btnIcon} ${pinnedTrackIds.includes(track.id) ? styles.pinActive : ""}`}><Pin size={14} /></button>
                            <button title="Remove from this preview" onClick={() => removeTrack(track.id)} className={styles.btnIcon}><X size={14} /></button>
                            <TrackPreviewButton trackId={track.id} />
                            <button title="Exclude from future Mixarr playlists" onClick={() => excludeTrack(track)} className={styles.btnIcon}><Ban size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={styles.mobileTrackCards}>
                {tracks.map((track, idx) => (
                  <article key={track.id} className={styles.mobileTrackCard}>
                    <div className={styles.mobileTrackTop}>
                      <span className={styles.mobileTrackOrder}>{idx + 1}</span>
                      <div>
                        <h5>{track.title || "—"}</h5>
                        <p>{track.artist?.title || "—"}</p>
                      </div>
                    </div>
                    <div className={styles.mobileTrackMeta}>
                      <span>Album <strong>{track.album?.title || "—"}</strong></span>
                      <span>Duration <strong>{formatDuration(track.duration)}</strong></span>
                      <span>BPM <strong>{(track.effectiveBpm ?? track.bpm ?? track.audioFeature?.tempo)?.toFixed(0) || "—"}</strong></span>
                      <span>Energy <strong>{(track.audioFeature?.effectiveEnergy ?? track.audioFeature?.energy)?.toFixed(2) || "—"}</strong></span>
                      <span>Mood <strong>{(track.audioFeature?.effectiveMood ?? track.audioFeature?.valence)?.toFixed(2) || "—"}</strong></span>
                    </div>
                    <div className={styles.mobileTrackActions}>
                      <button type="button" onClick={() => excludeTrack(track)} className={styles.btnSecondary}>
                        <Ban size={14} />
                        Exclude
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>

        {playlistPreview && (
          <details className={styles.detailsPanel}>
            <summary>Filters used and playlist stats</summary>
            <div className={styles.summaryGrid}>
              <div className={styles.summaryPanel}>
                <h4><ListChecks size={15} /> Filters used</h4>
                <dl>
                  {playlistPreview.filterSummary.map((item) => (
                    <div key={item.label}>
                      <dt>{item.label}</dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className={styles.summaryPanel}>
                <h4><Clock size={15} /> Playlist stats</h4>
                <dl>
                  <div><dt>BPM</dt><dd>{playlistPreview.summary.bpmRange}</dd></div>
                  <div><dt>Energy</dt><dd>{playlistPreview.summary.energyRange}</dd></div>
                  <div><dt>Mood</dt><dd>{playlistPreview.summary.moodRange}</dd></div>
                  <div><dt>Popularity</dt><dd>{playlistPreview.summary.popularityRange}</dd></div>
                  <div><dt>Artists</dt><dd>{playlistPreview.summary.diversity.artistCount}</dd></div>
                  <div><dt>Albums</dt><dd>{playlistPreview.summary.diversity.albumCount}</dd></div>
                  {(playlistPreview.summary.manualExclusionsRemoved || 0) > 0 && <div><dt>Manual exclusions</dt><dd>{playlistPreview.summary.manualExclusionsRemoved} removed</dd></div>}
                  <div><dt>Missing BPM</dt><dd>{playlistPreview.summary.missing.bpm}</dd></div>
                  <div><dt>Missing features</dt><dd>{playlistPreview.summary.missing.audioFeatures}</dd></div>
                </dl>
              </div>
            </div>
          </details>
        )}

        {history.length > 0 && (
          <div className={styles.historySection}>
            <h4>Recent Playlist History</h4>
            <div className={styles.historyList}>
              {history.slice(0, 5).map((item) => (
                <div key={item.id} className={styles.historyItem}>
                  <span>{item.name} ({item.trackCount})</span>
                  <span className={item.status === "success" ? styles.historySuccess : styles.historyFail}>{item.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>

    {showRecipeModal && (
      <div className={styles.modalOverlay} role="presentation">
        <div className={styles.recipeModal} role="dialog" aria-modal="true" aria-labelledby="save-recipe-title">
          <div className={styles.modalHeader}>
            <div>
              <h3 id="save-recipe-title">{activeRecipe ? "Save as New Playlist Recipe" : "Save Playlist Recipe"}</h3>
              <p>Save your current filters so you can reuse this playlist setup later.</p>
            </div>
            <button type="button" onClick={() => setShowRecipeModal(false)} className={styles.btnIcon} aria-label="Close save recipe dialog">
              <X size={16} />
            </button>
          </div>
          <label className={styles.optionLabel}>
            Recipe name
            <input value={recipeName} onChange={(e) => setRecipeName(e.target.value)} className={styles.input} autoFocus />
          </label>
          <label className={styles.optionLabel}>
            Description, optional
            <textarea value={recipeDescription} onChange={(e) => setRecipeDescription(e.target.value)} className={styles.textarea} rows={4} />
          </label>
          <div className={styles.modalActions}>
            <button type="button" onClick={() => setShowRecipeModal(false)} className={styles.btnSecondary}>
              Cancel
            </button>
            <button type="button" onClick={savePlaylistRecipe} disabled={savingRecipe} className={styles.btnPrimary}>
              {savingRecipe ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
              {activeRecipe ? "Save as New Recipe" : "Save Recipe"}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
