import prisma from "../prisma";
import { aiRequestCoordinator } from "../../ai/request-coordinator";
import { getAiGovernanceSettings } from "../../ai/governance/service";
import { defaultMixRecipeDocument, mixRecipeDocumentSchema, type MixRecipeDocument } from "../mixRecipes/schema";
import { playlistConfigSchema } from "../playlistService";
import { naturalLanguageInterpretationSchema, NATURAL_LANGUAGE_FEATURE_KEY, type NaturalLanguageInterpretation } from "./contracts";
import { defaultNaturalLanguageRecipe, mergeRecipePatch } from "./normalization";
export { interpretationRequiresClarification, mergeRecipePatch } from "./normalization";

const SYSTEM_INSTRUCTIONS = `You interpret playlist intent; you never select tracks or execute actions. Return only JSON for Mixarr's strict natural-language interpretation contract.
Required top-level keys: detectedLanguage, intent, summary, confidence, explicitConstraints, inferredConstraints, assumptions, ambiguities, unresolvedEntities, unsupportedRequests, recipePatch, warnings.
intent is create_playlist, revise_playlist, or similar_playlist. confidence contains overall and optional field scores from 0 through 1.
Every constraint has id, field, value, originalWording, explanation, confidence. Every assumption is visible and must include id, field, proposedValue, explanation, confidence, blocking, accepted=false.
Every ambiguity has id, originalPhrase, proposedInterpretation, reason, alternatives, affectedFields, confidence, requiresConfirmation, resolution=null.
Recipe patch may contain only metadata, generation, targets, bpmFlow, discovery, variety, and refreshPolicy. Never add automation, credentials, IDs, tracks, file paths, or unsupported schema fields. Refresh defaults to manual. Do not invent artists, albums, genres, playlists, or library IDs. Represent named entities in unresolvedEntities for local resolution.
Use generation.rules only for supported fields: genre, year, artist, album, tempo, energy, valence, popularity, rating, playCount, title, isLive, isRemaster, isExplicit, hasPopularity. Use only eq, contains, not_contains, gt, lt, gte, lte.
If duration is requested, state durationMinutes as a constraint and propose a transparent track-count approximation in generation.limit. Mark the duration-to-track conversion as an assumption. Low-confidence material interpretations must require confirmation. No chain-of-thought; provide concise user-facing explanations only.`;

type EntityResolution = { libraries: Array<{ id: string; serverId: string; name: string }>; playlists: Array<{ id: string; name: string; filters: unknown }>; recipes: Array<{ id: string; name: string }>; artists: Array<{ id: string; name: string }>; albums: Array<{ id: string; name: string }> };

async function resolveEntitiesLocally(userId: string, interpretation: NaturalLanguageInterpretation): Promise<{ interpretation: NaturalLanguageInterpretation; entities: EntityResolution }> {
  const entities: EntityResolution = { libraries: [], playlists: [], recipes: [], artists: [], albums: [] };
  const unresolved: NaturalLanguageInterpretation["unresolvedEntities"] = [];
  const ambiguities = [...interpretation.ambiguities];
  for (const entity of interpretation.unresolvedEntities) {
    const contains = entity.query.slice(0, 200);
    if (entity.type === "library") {
      const rows = await prisma.library.findMany({ where: { name: { contains, mode: "insensitive" }, server: { userId } }, select: { id: true, serverId: true, name: true }, take: 5 });
      entities.libraries.push(...rows);
      if (rows.length !== 1) unresolved.push(entity);
      if (rows.length > 1) ambiguities.push({ id: `entity-${entity.id}`, originalPhrase: entity.query, proposedInterpretation: rows[0].name, reason: "Multiple accessible Plex libraries match this name.", alternatives: rows.map((row) => ({ id: row.id, label: row.name, value: row.id })), affectedFields: ["library"], confidence: entity.confidence, requiresConfirmation: true, resolution: null });
    } else if (entity.type === "playlist") {
      const rows = await prisma.generatedPlaylist.findMany({ where: { userId, plexPlaylistTitle: { contains, mode: "insensitive" } }, select: { id: true, plexPlaylistTitle: true, filtersJson: true }, take: 5 });
      entities.playlists.push(...rows.map((row) => ({ id: row.id, name: row.plexPlaylistTitle, filters: row.filtersJson })));
      if (rows.length !== 1) unresolved.push(entity);
      if (rows.length > 1) ambiguities.push({ id: `entity-${entity.id}`, originalPhrase: entity.query, proposedInterpretation: rows[0].plexPlaylistTitle, reason: "Multiple accessible playlists match this name.", alternatives: rows.map((row) => ({ id: row.id, label: row.plexPlaylistTitle, value: row.id })), affectedFields: ["sourcePlaylist"], confidence: entity.confidence, requiresConfirmation: true, resolution: null });
    } else if (entity.type === "recipe") {
      const rows = await prisma.playlistRecipe.findMany({ where: { userId, name: { contains, mode: "insensitive" }, isArchived: false, deletedAt: null }, select: { id: true, name: true }, take: 5 });
      entities.recipes.push(...rows); if (rows.length !== 1) unresolved.push(entity);
    } else if (entity.type === "artist") {
      const rows = await prisma.artist.findMany({ where: { title: { contains, mode: "insensitive" }, library: { server: { userId } }, syncStatus: "active" }, select: { id: true, title: true }, take: 5 });
      entities.artists.push(...rows.map((row) => ({ id: row.id, name: row.title }))); if (rows.length !== 1) unresolved.push(entity);
    } else if (entity.type === "album") {
      const rows = await prisma.album.findMany({ where: { title: { contains, mode: "insensitive" }, library: { server: { userId } }, syncStatus: "active" }, select: { id: true, title: true }, take: 5 });
      entities.albums.push(...rows.map((row) => ({ id: row.id, name: row.title }))); if (rows.length !== 1) unresolved.push(entity);
    } else {
      const match = await prisma.tag.findFirst({ where: { name: { equals: entity.query, mode: "insensitive" } }, select: { name: true } });
      if (!match) unresolved.push(entity);
    }
  }
  return { interpretation: { ...interpretation, ambiguities, unresolvedEntities: unresolved }, entities };
}

export async function interpretNaturalLanguage(input: { userId: string; requestText: string; privacyMode?: "LOCAL_ONLY" | "METADATA_LIMITED" | "ANONYMOUS_METADATA" | "FULL_METADATA"; previous?: { interpretation: NaturalLanguageInterpretation; recipe: MixRecipeDocument; revisionText: string } }) {
  const governance = await getAiGovernanceSettings();
  const privacyMode = input.privacyMode || governance.privacyMode as "LOCAL_ONLY" | "METADATA_LIMITED" | "ANONYMOUS_METADATA" | "FULL_METADATA";
  const revisionContext = input.previous
    ? `\nCurrent approved-as-draft recipe (preserve unaffected fields): ${JSON.stringify(input.previous.recipe)}\nRevision requested: ${input.previous.revisionText}`
    : "";
  const response = await aiRequestCoordinator.complete({
    featureKey: NATURAL_LANGUAGE_FEATURE_KEY,
    systemInstructions: SYSTEM_INSTRUCTIONS,
    messages: [{ role: "user", content: `${input.requestText}${revisionContext}` }],
    responseFormat: { type: "json", name: "mixarr_natural_language_interpretation", schema: naturalLanguageInterpretationSchema, unknownFields: "reject" },
    privacyMode,
    maxOutputTokens: 2400,
    maxResponseBytes: 256_000,
    temperature: 0.1,
    requestSource: "FOREGROUND",
    allowFallback: true,
    requiredCapabilities: ["structured_json"],
    metadata: { workflow: "interpret_only", deterministic_execution: false },
  }, input.userId);
  const raw = naturalLanguageInterpretationSchema.parse(response.data);
  const provider = await prisma.aiProviderConfig.findUnique({ where: { id: response.providerId }, select: { displayName: true } });
  const resolved = await resolveEntitiesLocally(input.userId, raw);
  let base = input.previous?.recipe || defaultNaturalLanguageRecipe("Requested Playlist", raw.summary);
  const source = resolved.entities.playlists.length === 1 ? resolved.entities.playlists[0] : null;
  if (source && raw.intent === "similar_playlist") {
    const sourceGeneration = playlistConfigSchema.parse(source.filters);
    base = defaultMixRecipeDocument({ name: raw.recipePatch.metadata.name || `${source.name} Inspired Mix`, description: raw.summary, category: raw.recipePatch.metadata.category || "Custom", sourcePlaylistId: source.id }, { ...sourceGeneration, pinnedTrackIds: [], excludedTrackIds: [], coordinationSetup: { enabled: true, relationshipType: "RELATED", relatedPlaylistIds: [source.id], maximumSharedTrackPercentage: 20, overlapEnforcement: "HARD_MAXIMUM", allowSharedCoreTracks: false, preferGloballyUnusedTracks: true, unusedTrackPreferenceStrength: 0.6, crossPlaylistArtistBalancingEnabled: true, keepDistinct: true } });
  }
  let recipe = mergeRecipePatch(base, raw.recipePatch);
  if (resolved.entities.libraries.length === 1) recipe = mixRecipeDocumentSchema.parse({ ...recipe, generation: { ...recipe.generation, libraryId: resolved.entities.libraries[0].id, serverId: resolved.entities.libraries[0].serverId }, automationPolicy: { ...recipe.automationPolicy, libraryId: resolved.entities.libraries[0].id, enabled: false } });
  return { interpretation: resolved.interpretation, recipe, response, privacyMode, providerDisplayName: provider?.displayName || response.providerId, entities: resolved.entities };
}
