import type { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { aiRequestCoordinator } from "@/ai/request-coordinator";
import { previewAiRequest } from "@/ai/governance/service";
import { resolveAiProvider } from "@/ai/services/providerService";
import { PLAYLIST_SUMMARY_SYSTEM_PROMPT, playlistSummaryPrompt } from "@/ai/playlistSummaries/prompts";
import { METADATA_SUGGESTION_SYSTEM_PROMPT, metadataSuggestionPrompt } from "@/ai/metadataSuggestions/prompts";
import {
  METADATA_SUGGESTION_FEATURE_KEY, METADATA_SUGGESTION_PROMPT_VERSION, PLAYLIST_SUMMARY_FEATURE_KEY, PLAYLIST_SUMMARY_PROMPT_VERSION,
  SUMMARY_TYPES, advisorySettingsSchema, aiMetadataCandidateResponseSchema, bulkReviewRequestSchema,
  createIgnoreRuleSchema, exportRequestSchema, generateSummaryRequestSchema, metadataScanRequestSchema,
  reviewRequestSchema, summaryProviderResponseSchema, updateIgnoreRuleSchema, updateSummarySchema,
  type SummaryType,
} from "./contracts";
import {
  AI_METADATA_SUGGESTIONS_ENABLED, AI_METADATA_WRITES_ENABLED, AI_PLAYLIST_SUMMARIES_ENABLED, analyzePlaylist, assertMetadataWritesDisabled, detectMetadataCandidates,
  ignoreRuleMatches, privacyAwarePlaylistPayload, responseReferencesOnlySubmittedCandidates,
  suggestionFingerprint, validateSummaryEvidence, type MetadataCandidate, type PlaylistAnalysisTrack,
} from "./core";
import { requireAiAdvisoryPermission } from "./permissions";

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const fail = (code: string, message: string, status = 400) => Object.assign(new Error(message), { code, status });
const defaultSummaryTypes: SummaryType[] = ["ONE_SENTENCE", "DETAILED_DESCRIPTION", "PLEX_FRIENDLY"];
const cleanError = (error: unknown) => (error instanceof Error ? error.message : "The operation failed.").replace(/(api[-_ ]?key|authorization|bearer)\s*[:=]\s*\S+/gi, "$1=[redacted]").slice(0, 1000);

export async function getAdvisorySettings(userId: string) {
  await requireAiAdvisoryPermission(userId, "ai.summary.view", userId);
  const row = await prisma.aiAdvisorySetting.upsert({
    where: { userId }, update: {},
    create: { userId, defaultSummaryTypesJson: json(defaultSummaryTypes) },
  });
  return { ...row, defaultSummaryTypes: row.defaultSummaryTypesJson as unknown as SummaryType[], aiMetadataWritesEnabled: AI_METADATA_WRITES_ENABLED };
}

export async function updateAdvisorySettings(userId: string, raw: unknown) {
  await requireAiAdvisoryPermission(userId, "ai.summary.manage", userId);
  const input = advisorySettingsSchema.parse(raw);
  assertMetadataWritesDisabled();
  return prisma.aiAdvisorySetting.upsert({
    where: { userId },
    create: { userId, ...input, defaultSummaryTypesJson: json(input.defaultSummaryTypes) },
    update: { ...input, defaultSummaryTypesJson: json(input.defaultSummaryTypes) },
  });
}

async function ownedPlaylist(userId: string, playlistId: string) {
  const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: playlistId, userId }, include: { tracks: { orderBy: { position: "asc" } } } });
  if (!playlist) throw fail("PLAYLIST_NOT_FOUND", "Playlist not found or outside the permitted scope.", 404);
  return playlist;
}

async function permittedLibraryIds(userId: string, libraryId?: string | null) {
  const rows = await prisma.library.findMany({ where: { server: { userId }, ...(libraryId ? { id: libraryId } : {}) }, select: { id: true } });
  if (libraryId && !rows.length) throw fail("LIBRARY_NOT_FOUND", "Library not found or outside the permitted scope.", 404);
  return rows.map((row) => row.id);
}

function toAnalysisTrack(row: any, position?: { title: string; artist?: string | null; album?: string | null; plexTrackRatingKey?: string | null }): PlaylistAnalysisTrack {
  const tags = Array.isArray(row?.tags) ? row.tags : [];
  return {
    id: row?.id || position?.plexTrackRatingKey || crypto.randomUUID(), identifier: row?.ratingKey || position?.plexTrackRatingKey || row?.id,
    title: row?.title || position?.title || "Unknown track", artist: row?.artist?.title || position?.artist,
    album: row?.album?.title || position?.album, albumId: row?.albumId,
    duration: row?.duration, bpm: row?.effectiveBpm ?? row?.bpm ?? row?.audioFeature?.tempo,
    energy: row?.audioFeature?.effectiveEnergy ?? row?.audioFeature?.energy, year: row?.album?.year,
    genres: tags.filter((tag: any) => tag.type === "genre" || tag.type === "style").map((tag: any) => tag.name),
    moods: tags.filter((tag: any) => tag.type === "mood").map((tag: any) => tag.name), explicit: row?.isExplicit === true,
    familiar: typeof row?.viewCount === "number" ? row.viewCount > 0 : null,
    recentlyAdded: row?.addedAt ? Date.now() - new Date(row.addedAt).getTime() <= 90 * 86_400_000 : null,
  };
}

async function playlistTracksForAnalysis(playlist: Awaited<ReturnType<typeof ownedPlaylist>>) {
  const ids = playlist.tracks.map((track) => track.trackId).filter((id): id is string => Boolean(id));
  const rows = ids.length ? await prisma.track.findMany({ where: { id: { in: ids }, syncStatus: "active", deletedAt: null }, include: { artist: true, album: true, tags: true, audioFeature: true } }) : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  return playlist.tracks.map((position) => toAnalysisTrack(position.trackId ? byId.get(position.trackId) : null, position));
}

export async function createPlaylistAnalysisSnapshot(userId: string, playlistId: string, privacyMode: string, allowFullTrackMetadata: boolean, notes?: string) {
  const playlist = await ownedPlaylist(userId, playlistId);
  const tracks = await playlistTracksForAnalysis(playlist);
  const previous = await prisma.playlistAnalysisSnapshot.findFirst({ where: { playlistId, userId }, orderBy: { createdAt: "desc" } });
  const previousAnalysis = previous?.analysisJson as any;
  const analysis = analyzePlaylist({
    playlist: { id: playlist.id, name: playlist.plexPlaylistTitle, type: playlist.sourceType, purpose: (playlist.filtersJson as any)?.purpose, recipeName: playlist.recipeName, sourceType: playlist.sourceType, refreshedAt: playlist.lastRegeneratedAt || playlist.lastGeneratedAt, notes },
    tracks,
    previous: previousAnalysis ? { trackIds: previousAnalysis.trackIds || [], durationMs: previousAnalysis.facts?.durationMs, uniqueArtists: previousAnalysis.facts?.uniqueArtistCount, genreDistribution: previousAnalysis.facts?.genreDistribution, discoveryPercent: previousAnalysis.facts?.discoveryTrackPercent, averageEnergy: previousAnalysis.facts?.averageEnergy, averageBpm: previousAnalysis.facts?.averageBpm } : null,
  });
  const privacy = privacyAwarePlaylistPayload(analysis, tracks, privacyMode, allowFullTrackMetadata);
  const latestRevision = await prisma.playlistRevision.findFirst({ where: { generatedPlaylistId: playlistId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const snapshot = await prisma.playlistAnalysisSnapshot.create({ data: { userId, playlistId, sourceRevisionId: latestRevision?.id, previousSnapshotId: previous?.id, privacyMode, analysisJson: json(analysis), aggregatePayloadJson: json({ schemaVersion: analysis.schemaVersion, facts: analysis.facts, availableFacts: analysis.availableFacts }), fullPayloadJson: privacy.aggregateOnly ? undefined : json(privacy.payload), trackCount: tracks.length, fingerprint: analysis.fingerprint } });
  return { snapshot, analysis, tracks, privacy };
}

async function aiSelection(featureKey: string, options: { providerId?: string; model?: string; privacyMode?: string }, userId: string, request: { systemInstructions: string; message: string; responseSchema: any; estimatedOutputTokens: number; metadataRecords?: Array<Record<string, unknown>> }) {
  const [global, feature, governance] = await Promise.all([
    prisma.aiGlobalSetting.findUnique({ where: { id: "global" } }), prisma.aiFeatureSetting.findUnique({ where: { featureKey } }), prisma.aiGovernanceSetting.findUnique({ where: { id: "global" } }),
  ]);
  if (!global?.enabled) throw fail("AI_DISABLED", "AI is disabled.", 409);
  if (!feature?.implemented || !feature.enabled) throw fail("FEATURE_DISABLED", "This AI feature is disabled. Enable it after reviewing privacy and budget settings.", 409);
  const providerId = options.providerId || feature.preferredProviderId || global.defaultProviderId;
  if (!providerId) throw fail("PROVIDER_NOT_CONFIGURED", "No AI provider is configured for this feature.", 409);
  const provider = await resolveAiProvider(providerId);
  const model = options.model || feature.preferredModel || provider.defaultModel;
  if (!model) throw fail("MODEL_NOT_CONFIGURED", "No AI model is configured for this feature.", 409);
  const privacyMode = options.privacyMode || governance?.privacyMode || "METADATA_LIMITED";
  const promptTemplateVersion = featureKey === PLAYLIST_SUMMARY_FEATURE_KEY ? PLAYLIST_SUMMARY_PROMPT_VERSION : METADATA_SUGGESTION_PROMPT_VERSION;
  const aiRequest = { featureKey, providerId, model, systemInstructions: request.systemInstructions, messages: [{ role: "user" as const, content: request.message }], responseFormat: { type: "json" as const, name: featureKey, schema: request.responseSchema, unknownFields: "reject" as const }, privacyMode: privacyMode as any, estimatedOutputTokens: request.estimatedOutputTokens, maxResponseBytes: 512_000, temperature: 0.1, requestSource: "FOREGROUND" as const, allowFallback: false, requiredCapabilities: ["structured_json" as const], contextTrimmingStrategy: "REMOVE_LOWEST_PRIORITY" as const, metadataRecords: request.metadataRecords, promptTemplateVersion };
  const preview = await previewAiRequest({ request: aiRequest, provider, model, userId });
  return { provider, providerId, model, privacyMode, preview, aiRequest };
}

export async function previewPlaylistSummaryRequest(userId: string, playlistId: string, raw: unknown) {
  await requireAiAdvisoryPermission(userId, "ai.summary.generate", userId);
  const input = generateSummaryRequestSchema.parse(raw);
  if (!AI_PLAYLIST_SUMMARIES_ENABLED) throw fail("FEATURE_FLAG_DISABLED", "Playlist AI summaries are disabled by the deployment feature flag.", 409);
  const settings = await getAdvisorySettings(userId);
  if (!settings.playlistSummariesEnabled) throw fail("PLAYLIST_SUMMARIES_DISABLED", "Playlist summaries are disabled in AI advisory settings.", 409);
  const privacyMode = input.privacyMode || "METADATA_LIMITED";
  const built = await createPlaylistAnalysisSnapshot(userId, playlistId, privacyMode, settings.allowFullTrackMetadata, input.notes);
  const selection = await aiSelection(PLAYLIST_SUMMARY_FEATURE_KEY, input, userId, { systemInstructions: PLAYLIST_SUMMARY_SYSTEM_PROMPT, message: playlistSummaryPrompt({ types: input.summaryTypes, payload: built.privacy.payload, notes: input.notes, plexLimit: settings.plexDescriptionMaxLength }), responseSchema: summaryProviderResponseSchema, estimatedOutputTokens: 4000, metadataRecords: [{ playlist_analysis: built.privacy.payload }] });
  return { snapshotId: built.snapshot.id, privacyMode: selection.preview.privacyMode, provider: selection.preview.provider, limits: selection.preview.limits, cost: selection.preview.cost, includedFields: built.analysis.availableFacts, blockedFields: built.privacy.blockedFields, aggregateOnly: built.privacy.aggregateOnly, previewRequired: selection.preview.privacyMode === "FULL_METADATA" || selection.preview.provider.location !== "LOCAL" };
}

export async function generatePlaylistSummaries(userId: string, playlistId: string, raw: unknown) {
  await requireAiAdvisoryPermission(userId, "ai.summary.generate", userId);
  const input = generateSummaryRequestSchema.parse(raw);
  if (!AI_PLAYLIST_SUMMARIES_ENABLED) throw fail("FEATURE_FLAG_DISABLED", "Playlist AI summaries are disabled by the deployment feature flag.", 409);
  const settings = await getAdvisorySettings(userId);
  if (!settings.playlistSummariesEnabled) throw fail("PLAYLIST_SUMMARIES_DISABLED", "Playlist summaries are disabled in AI advisory settings.", 409);
  const privacyMode = input.privacyMode || "METADATA_LIMITED";
  const previousSummaryCount = await prisma.playlistAiSummary.count({ where: { playlistId, summaryType: { in: input.summaryTypes }, status: "COMPLETED" } });
  const built = await createPlaylistAnalysisSnapshot(userId, playlistId, privacyMode, settings.allowFullTrackMetadata, input.notes);
  const selection = await aiSelection(PLAYLIST_SUMMARY_FEATURE_KEY, input, userId, { systemInstructions: PLAYLIST_SUMMARY_SYSTEM_PROMPT, message: playlistSummaryPrompt({ types: input.summaryTypes, payload: built.privacy.payload, notes: input.notes, plexLimit: settings.plexDescriptionMaxLength }), responseSchema: summaryProviderResponseSchema, estimatedOutputTokens: 4000, metadataRecords: [{ playlist_analysis: built.privacy.payload }] });
  if (selection.preview.privacyMode === "FULL_METADATA" && selection.preview.provider.location !== "LOCAL" && input.previewAcknowledged !== true) throw fail("AI_PREVIEW_ACKNOWLEDGMENT_REQUIRED", "Review and acknowledge the full-metadata request preview before generation.", 409);
  try {
    const response = await aiRequestCoordinator.complete({ ...selection.aiRequest, externalConfirmation: input.previewAcknowledged === true }, userId);
    const output = summaryProviderResponseSchema.parse(response.data);
    const requested = new Set(input.summaryTypes); const returned = new Set(output.summaries.map((summary) => summary.type));
    if (returned.size !== output.summaries.length || output.summaries.some((summary) => !requested.has(summary.type)) || input.summaryTypes.some((type) => !returned.has(type))) throw fail("INVALID_AI_RESPONSE", "The provider did not return exactly the requested summary types.", 422);
    const rows = [];
    for (const result of output.summaries) {
      const text = validateSummaryEvidence(result.type, result.text, built.analysis.facts, result.type === "PLEX_FRIENDLY" ? settings.plexDescriptionMaxLength : undefined);
      rows.push(await prisma.playlistAiSummary.create({ data: { playlistId, snapshotId: built.snapshot.id, createdById: userId, summaryType: result.type, generatedText: text, providerConfigId: response.providerId, providerDisplayName: selection.provider.displayName, model: response.model, privacyMode: selection.preview.privacyMode, promptTemplateVersion: PLAYLIST_SUMMARY_PROMPT_VERSION, requestId: response.requestId, inputTokenCount: response.usage?.inputTokens, outputTokenCount: response.usage?.outputTokens, estimatedCost: response.estimatedCost, actualCost: response.actualCost, status: "COMPLETED" } }));
    }
    await audit({ actorId: userId, action: previousSummaryCount ? "SUMMARY_REGENERATED" : "SUMMARY_GENERATED", objectType: "PLAYLIST_AI_SUMMARY", objectId: playlistId, playlistId, requestOrJobId: response.requestId, suggestionCount: rows.length, providerDisplayName: selection.provider.displayName, model: response.model, safeMetadata: { summaryTypes: input.summaryTypes, privacyMode: selection.preview.privacyMode } });
    return { summaries: rows, snapshotId: built.snapshot.id, requestId: response.requestId, usage: response.usage, estimatedCost: response.estimatedCost, actualCost: response.actualCost };
  } catch (error) {
    await prisma.playlistAiSummary.createMany({ data: input.summaryTypes.map((type) => ({ playlistId, snapshotId: built.snapshot.id, createdById: userId, summaryType: type, generatedText: "", providerConfigId: selection.providerId, providerDisplayName: selection.provider.displayName, model: selection.model, privacyMode: selection.preview.privacyMode, promptTemplateVersion: PLAYLIST_SUMMARY_PROMPT_VERSION, status: "FAILED", errorCode: String((error as any)?.code || (error as any)?.category || "SUMMARY_GENERATION_FAILED"), errorDetails: cleanError(error) })) });
    throw error;
  }
}

export async function listPlaylistSummaries(userId: string, playlistId: string, options: { type?: string; includeArchived?: boolean; page?: number; pageSize?: number } = {}) {
  await requireAiAdvisoryPermission(userId, "ai.summary.view", userId); await ownedPlaylist(userId, playlistId);
  const page = Math.max(1, options.page || 1), pageSize = Math.min(100, Math.max(1, options.pageSize || 25));
  const where = { playlistId, ...(options.type ? { summaryType: options.type } : {}), ...(options.includeArchived ? {} : { archivedAt: null }) };
  const [rows, total] = await Promise.all([prisma.playlistAiSummary.findMany({ where, orderBy: { generatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }), prisma.playlistAiSummary.count({ where })]);
  return { summaries: rows, pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) }, approvedSuggestionMeaning: "Approved suggestions are recommendations only; no metadata has been applied." };
}

async function ownedSummary(userId: string, playlistId: string, summaryId: string) {
  const row = await prisma.playlistAiSummary.findFirst({ where: { id: summaryId, playlistId }, include: { playlist: { select: { userId: true } } } });
  if (!row) throw fail("SUMMARY_NOT_FOUND", "Playlist summary not found.", 404);
  await requireAiAdvisoryPermission(userId, "ai.summary.manage", row.playlist.userId); return row;
}

export async function updatePlaylistSummary(userId: string, playlistId: string, summaryId: string, raw: unknown) {
  const input = updateSummarySchema.parse(raw), current = await ownedSummary(userId, playlistId, summaryId);
  const update = async (tx: Prisma.TransactionClient) => {
    if (input.preferred) await tx.playlistAiSummary.updateMany({ where: { playlistId, summaryType: current.summaryType, id: { not: summaryId } }, data: { preferred: false } });
    if (input.saveAsPlaylistNotes) await tx.generatedPlaylist.update({ where: { id: playlistId }, data: { localPlaylistNotes: current.generatedText } });
    return tx.playlistAiSummary.update({ where: { id: summaryId }, data: { ...(input.generatedText !== undefined ? { generatedText: input.generatedText, originalAiGeneratedText: current.originalAiGeneratedText || current.generatedText, manuallyEdited: true } : {}), ...(input.preferred !== undefined ? { preferred: input.preferred } : {}), ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}) } });
  };
  const row = await prisma.$transaction(update);
  await audit({ suggestionId: null, actorId: userId, action: input.generatedText !== undefined ? "SUMMARY_EDITED" : input.preferred !== undefined ? "PREFERRED_SUMMARY_CHANGED" : input.saveAsPlaylistNotes ? "SUMMARY_SAVED_AS_LOCAL_PLAYLIST_NOTES" : "SUMMARY_ARCHIVED", objectType: "PLAYLIST_AI_SUMMARY", objectId: summaryId, playlistId, safeMetadata: input.saveAsPlaylistNotes ? { localOnly: true, plexModified: false } : undefined });
  return row;
}

export async function deletePlaylistSummary(userId: string, playlistId: string, summaryId: string) {
  await ownedSummary(userId, playlistId, summaryId); await prisma.playlistAiSummary.delete({ where: { id: summaryId } });
  await audit({ actorId: userId, action: "SUMMARY_DELETED", objectType: "PLAYLIST_AI_SUMMARY", objectId: summaryId, playlistId });
  return { deleted: true };
}

export async function queueAutomaticPlaylistRefreshSummary(userId: string, playlistId: string) {
  const settings = await prisma.aiAdvisorySetting.findUnique({ where: { userId } });
  if (!settings?.playlistSummariesEnabled || !settings.automaticRefreshSummaries) return { queued: false, reason: "DISABLED" };
  const governance = await prisma.aiGovernanceSetting.findUnique({ where: { id: "global" }, select: { privacyMode: true } });
  const privacyMode = governance?.privacyMode === "LOCAL_ONLY" ? "LOCAL_ONLY" : "METADATA_LIMITED";
  setImmediate(() => { void generatePlaylistSummaries(userId, playlistId, { summaryTypes: ["REFRESH"], privacyMode, previewAcknowledged: true }).catch(() => undefined); });
  return { queued: true, summaryType: "REFRESH", preferredSummaryWillBeReplaced: false };
}

async function audit(input: { suggestionId?: string | null; actorId?: string | null; action: string; objectType: string; objectId: string; libraryId?: string | null; playlistId?: string | null; requestOrJobId?: string | null; suggestionCount?: number; affectedTrackCount?: number; previousStatus?: string | null; newStatus?: string | null; providerDisplayName?: string | null; model?: string | null; safeMetadata?: unknown }, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  return tx.metadataSuggestionAuditEvent.create({ data: { suggestionId: input.suggestionId, actorId: input.actorId, action: input.action, objectType: input.objectType, objectId: input.objectId, libraryId: input.libraryId, playlistId: input.playlistId, requestOrJobId: input.requestOrJobId, suggestionCount: input.suggestionCount || 0, affectedTrackCount: input.affectedTrackCount || 0, previousStatus: input.previousStatus, newStatus: input.newStatus, providerDisplayName: input.providerDisplayName, model: input.model, safeMetadataJson: input.safeMetadata == null ? undefined : json(input.safeMetadata) } });
}

function aiCandidatePayload(candidate: MetadataCandidate, privacyMode: string) {
  const base = { candidateId: candidate.id, suggestionType: candidate.suggestionType, field: candidate.field, existingValue: candidate.existingValue, deterministicSuggestedValue: candidate.suggestedValue, deterministicReason: candidate.reason, confidenceScore: candidate.confidenceScore, confidenceLevel: candidate.confidenceLevel, detectionMethod: candidate.detectionMethod, sourceMetadata: candidate.sourceMetadata, conflictingSourceMetadata: candidate.conflictingSourceMetadata || null, advisoryOnly: true };
  if (privacyMode === "FULL_METADATA" || privacyMode === "LOCAL_ONLY") return { ...base, affectedTracks: candidate.trackSnapshots };
  return { ...base, affectedTrackCount: candidate.trackIds.length, affectedAlbumCount: candidate.albums.length, affectedArtistCount: candidate.artists.length };
}

async function enhanceCandidatesWithAi(userId: string, candidates: MetadataCandidate[], options: { providerId?: string; model?: string; privacyMode?: string }) {
  const payload = candidates.map((candidate) => aiCandidatePayload(candidate, options.privacyMode || "METADATA_LIMITED"));
  const selection = await aiSelection(METADATA_SUGGESTION_FEATURE_KEY, options, userId, { systemInstructions: METADATA_SUGGESTION_SYSTEM_PROMPT, message: metadataSuggestionPrompt(payload), responseSchema: aiMetadataCandidateResponseSchema, estimatedOutputTokens: 5000, metadataRecords: payload as Array<Record<string, unknown>> });
  const response = await aiRequestCoordinator.complete({ ...selection.aiRequest, requestSource: "BACKGROUND", backgroundApproval: true }, userId);
  const output = aiMetadataCandidateResponseSchema.parse(response.data);
  if (!responseReferencesOnlySubmittedCandidates(candidates.map((candidate) => candidate.id), output.suggestions.map((suggestion) => suggestion.candidateId))) throw fail("INVALID_TRACK_REFERENCE", "The AI response referenced a candidate outside the submitted batch.", 422);
  const byId = new Map(output.suggestions.map((suggestion) => [suggestion.candidateId, suggestion]));
  return { candidates: candidates.map((candidate) => { const enhancement = byId.get(candidate.id); return enhancement ? { ...candidate, suggestedValue: enhancement.suggestedValue, reason: enhancement.reason, confidenceScore: enhancement.confidenceScore, confidenceLevel: enhancement.confidenceLevel } : candidate; }), response, selection };
}

async function persistCandidate(userId: string, libraryId: string, jobId: string, candidate: MetadataCandidate, rules: any[], provider?: { id?: string; displayName?: string; model?: string }) {
  const matchedRule = rules.find((rule) => ignoreRuleMatches(candidate, rule.scope, rule.matchJson as Record<string, unknown>));
  if (matchedRule) { await prisma.metadataIgnoreRule.update({ where: { id: matchedRule.id }, data: { suppressedCount: { increment: 1 } } }); return { created: false, deduplicated: false, suppressed: true, conflict: candidate.confidenceLevel === "CONFLICTING_SOURCES" }; }
  const fp = suggestionFingerprint(candidate);
  const existing = await prisma.metadataSuggestion.findUnique({ where: { ownerId_fingerprint: { ownerId: userId, fingerprint: fp } } });
  if (existing) {
    const final = ["APPROVED", "REJECTED", "IGNORED"].includes(existing.status);
    await prisma.metadataSuggestion.update({ where: { id: existing.id }, data: { lastDetectedAt: new Date(), detectionCount: { increment: 1 }, analysisJobId: jobId, ...(final ? {} : { reason: candidate.reason, confidenceScore: candidate.confidenceScore, confidenceLevel: candidate.confidenceLevel, sourceMetadataJson: json(candidate.sourceMetadata), conflictingSourceJson: candidate.conflictingSourceMetadata ? json(candidate.conflictingSourceMetadata) : undefined }) } });
    return { created: false, deduplicated: true, suppressed: false, conflict: candidate.confidenceLevel === "CONFLICTING_SOURCES" };
  }
  const row = await prisma.metadataSuggestion.create({ data: { ownerId: userId, libraryId, analysisJobId: jobId, suggestionType: candidate.suggestionType, field: candidate.field, existingValue: candidate.existingValue, suggestedValue: candidate.suggestedValue, reason: candidate.reason, confidenceScore: candidate.confidenceScore, confidenceLevel: candidate.confidenceLevel, detectionMethod: candidate.detectionMethod, sourceMetadataJson: json(candidate.sourceMetadata), conflictingSourceJson: candidate.conflictingSourceMetadata ? json(candidate.conflictingSourceMetadata) : undefined, affectedTrackCount: candidate.trackIds.length, affectedAlbumCount: candidate.albums.length, affectedArtistCount: candidate.artists.length, affectedAlbumsJson: json(candidate.albums), affectedArtistsJson: json(candidate.artists), plexImpact: candidate.plexImpact, sourceLibraryImpact: candidate.sourceLibraryImpact, embeddedTagImpact: candidate.embeddedTagImpact, providerConfigId: provider?.id, providerDisplayName: provider?.displayName, model: provider?.model, fingerprint: fp, status: candidate.confidenceLevel === "CONFLICTING_SOURCES" ? "CONFLICT" : "PENDING", tracks: { create: candidate.trackSnapshots.map((track) => ({ trackId: track.id, trackIdentifier: track.identifier, titleSnapshot: track.title, artistSnapshot: track.artist, albumSnapshot: track.album })) }, sources: { create: [
    { sourceType: "MIXARR_DATABASE", field: candidate.field, valueJson: json(candidate.sourceMetadata), available: true, queried: true, supportsValue: true },
    { sourceType: "PLEX", field: candidate.field, valueJson: candidate.existingValue == null ? undefined : json(candidate.existingValue), available: true, queried: true, supportsValue: candidate.existingValue === candidate.suggestedValue },
    ...["SOURCE_LIBRARY", "EMBEDDED_TAGS", "MUSICBRAINZ", "DISCOGS", "LASTFM_STYLE", "USER_OVERRIDE"].map((sourceType) => ({ sourceType, field: candidate.field, available: false, queried: false })),
  ] } } });
  await audit({ suggestionId: row.id, actorId: null, action: "SUGGESTION_CREATED", objectType: "METADATA_SUGGESTION", objectId: row.id, libraryId, requestOrJobId: jobId, suggestionCount: 1, affectedTrackCount: candidate.trackIds.length, newStatus: row.status, providerDisplayName: provider?.displayName, model: provider?.model });
  return { created: true, deduplicated: false, suppressed: false, conflict: candidate.confidenceLevel === "CONFLICTING_SOURCES" };
}

export async function startMetadataScan(userId: string, raw: unknown) {
  await requireAiAdvisoryPermission(userId, "ai.metadata_suggestions.generate", userId);
  const input = metadataScanRequestSchema.parse(raw), settings = await getAdvisorySettings(userId);
  if (!AI_METADATA_SUGGESTIONS_ENABLED) throw fail("FEATURE_FLAG_DISABLED", "Metadata suggestion analysis is disabled by the deployment feature flag.", 409);
  if (!settings.metadataSuggestionsEnabled) throw fail("METADATA_SUGGESTIONS_DISABLED", "Metadata suggestion analysis is disabled until explicitly enabled.", 409);
  const libraryIds = await permittedLibraryIds(userId, input.libraryId);
  if (!libraryIds.length) throw fail("NO_LIBRARIES", "No permitted music libraries are available to scan.", 409);
  const job = await prisma.metadataAnalysisJob.create({ data: { userId, libraryId: input.libraryId, privacyMode: input.privacyMode || "METADATA_LIMITED", providerConfigId: input.providerId, model: input.model, batchSize: input.batchSize || settings.metadataAnalysisBatchSize, progressJson: json({ stage: "QUEUED", libraryIds, metadataWritesEnabled: false }) } });
  await audit({ actorId: userId, action: "METADATA_SCAN_STARTED", objectType: "METADATA_ANALYSIS_JOB", objectId: job.id, libraryId: input.libraryId, requestOrJobId: job.id, safeMetadata: { libraryCount: libraryIds.length, useAi: input.useAi, batchSize: job.batchSize } });
  return { job, input: { ...input, libraryIds } };
}

export async function runMetadataScanJob(userId: string, jobId: string, rawInput: unknown) {
  const input = metadataScanRequestSchema.parse(rawInput), job = await prisma.metadataAnalysisJob.findFirst({ where: { id: jobId, userId } });
  if (!job) throw fail("JOB_NOT_FOUND", "Metadata analysis job not found.", 404);
  const settings = await getAdvisorySettings(userId), libraryIds = await permittedLibraryIds(userId, input.libraryId);
  const rules = await prisma.metadataIgnoreRule.findMany({ where: { creatorId: userId, enabled: true } });
  const counts = { librariesScanned: 0, tracksScanned: 0, candidateIssuesFound: 0, aiBatchesCompleted: 0, suggestionsCreated: 0, suggestionsDeduplicated: 0, suggestionsSuppressed: 0, conflictsFound: 0, completedBatchCount: 0, failedBatchCount: 0 };
  const warnings: string[] = [];
  await prisma.metadataAnalysisJob.update({ where: { id: jobId }, data: { status: "PREPARING_CANDIDATES", startedAt: new Date(), progressJson: json({ stage: "PREPARING_CANDIDATES" }) } });
  try {
    for (const libraryId of libraryIds) {
      let cursor: string | undefined;
      while (true) {
        const fresh = await prisma.metadataAnalysisJob.findUnique({ where: { id: jobId }, select: { cancellationRequestedAt: true } });
        if (fresh?.cancellationRequestedAt) { await prisma.metadataAnalysisJob.update({ where: { id: jobId }, data: { status: "CANCELLED", completedAt: new Date(), ...counts, warningsJson: json(warnings), progressJson: json({ stage: "CANCELLED" }) } }); return { cancelled: true, ...counts }; }
        const rows = await prisma.track.findMany({ where: { libraryId, syncStatus: "active", deletedAt: null }, include: { artist: true, album: true, tags: true, audioFeature: true }, orderBy: { id: "asc" }, take: job.batchSize, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
        if (!rows.length) break;
        cursor = rows[rows.length - 1].id; counts.tracksScanned += rows.length;
        let candidates = settings.deterministicChecksEnabled ? detectMetadataCandidates(rows.map((row) => toAnalysisTrack(row))) : [];
        counts.candidateIssuesFound += candidates.length;
        let provider: { id?: string; displayName?: string; model?: string } | undefined;
        if (input.useAi && settings.aiAssistedChecksEnabled && candidates.length) {
          await prisma.metadataAnalysisJob.update({ where: { id: jobId }, data: { status: "ANALYZING" } });
          try { const enhanced = await enhanceCandidatesWithAi(userId, candidates, input); candidates = enhanced.candidates; provider = { id: enhanced.response.providerId, displayName: enhanced.selection.provider.displayName, model: enhanced.response.model }; counts.aiBatchesCompleted += 1; await prisma.metadataAnalysisJob.update({ where: { id: jobId }, data: { providerConfigId: provider.id, providerDisplayName: provider.displayName, model: provider.model, requestId: enhanced.response.requestId } }); }
          catch (error) { counts.failedBatchCount += 1; warnings.push(`AI batch retained deterministic results: ${cleanError(error)}`); }
        }
        await prisma.metadataAnalysisJob.update({ where: { id: jobId }, data: { status: "SAVING_SUGGESTIONS" } });
        for (const candidate of candidates) { const result = await persistCandidate(userId, libraryId, jobId, candidate, rules, provider); if (result.created) counts.suggestionsCreated++; if (result.deduplicated) counts.suggestionsDeduplicated++; if (result.suppressed) counts.suggestionsSuppressed++; if (result.conflict) counts.conflictsFound++; }
        counts.completedBatchCount += 1;
        await prisma.metadataAnalysisJob.update({ where: { id: jobId }, data: { ...counts, progressJson: json({ stage: "SAVING_SUGGESTIONS", currentLibraryId: libraryId, cursor, metadataWritesEnabled: false }), warningsJson: json(warnings) } });
        if (rows.length < job.batchSize) break;
      }
      counts.librariesScanned += 1;
    }
    const status = counts.failedBatchCount ? "COMPLETED_WITH_WARNINGS" : "COMPLETED";
    const updated = await prisma.metadataAnalysisJob.update({ where: { id: jobId }, data: { status, completedAt: new Date(), ...counts, warningsJson: json(warnings), progressJson: json({ stage: status, metadataWritesEnabled: false }) } });
    await audit({ actorId: userId, action: "METADATA_SCAN_COMPLETED", objectType: "METADATA_ANALYSIS_JOB", objectId: jobId, libraryId: job.libraryId, requestOrJobId: jobId, suggestionCount: counts.suggestionsCreated, affectedTrackCount: counts.tracksScanned, newStatus: status, safeMetadata: counts });
    return updated;
  } catch (error) {
    await prisma.metadataAnalysisJob.update({ where: { id: jobId }, data: { status: "FAILED", completedAt: new Date(), errorDetails: cleanError(error), ...counts, warningsJson: json(warnings), progressJson: json({ stage: "FAILED", partialResultsRetained: true }) } });
    throw error;
  }
}

export async function cancelMetadataScan(userId: string, jobId: string) {
  await requireAiAdvisoryPermission(userId, "ai.metadata_suggestions.generate", userId);
  const row = await prisma.metadataAnalysisJob.findFirst({ where: { id: jobId, userId } }); if (!row) throw fail("JOB_NOT_FOUND", "Metadata analysis job not found.", 404);
  if (["COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED", "CANCELLED"].includes(row.status)) throw fail("JOB_ALREADY_FINAL", "This metadata analysis job has already finished.", 409);
  return prisma.metadataAnalysisJob.update({ where: { id: jobId }, data: { cancellationRequestedAt: new Date(), progressJson: json({ stage: row.status, cancellationRequested: true }) } });
}

export async function getMetadataJob(userId: string, jobId: string) { await requireAiAdvisoryPermission(userId, "ai.metadata_suggestions.view", userId); const row = await prisma.metadataAnalysisJob.findFirst({ where: { id: jobId, userId } }); if (!row) throw fail("JOB_NOT_FOUND", "Metadata analysis job not found.", 404); return row; }

function suggestionWhere(userId: string, query: URLSearchParams) {
  const where: any = { ownerId: userId };
  for (const [key, field] of [["status", "status"], ["confidence", "confidenceLevel"], ["type", "suggestionType"], ["field", "field"], ["provider", "providerDisplayName"], ["detectionMethod", "detectionMethod"], ["libraryId", "libraryId"], ["playlistId", "playlistId"]] as const) { const value = query.get(key); if (value) where[field] = value; }
  for (const [key, field] of [["plexImpact", "plexImpact"], ["sourceLibraryImpact", "sourceLibraryImpact"], ["embeddedTagImpact", "embeddedTagImpact"]] as const) { const value = query.get(key); if (value === "true" || value === "false") where[field] = value === "true"; }
  const artist = query.get("artist"), album = query.get("album"), source = query.get("source");
  if (artist) where.affectedArtistsJson = { array_contains: [artist] }; if (album) where.affectedAlbumsJson = { array_contains: [album] }; if (source) where.sources = { some: { sourceType: source } };
  const createdFrom = query.get("createdFrom"), createdTo = query.get("createdTo"); if (createdFrom || createdTo) where.createdAt = { ...(createdFrom ? { gte: new Date(createdFrom) } : {}), ...(createdTo ? { lte: new Date(createdTo) } : {}) };
  if (query.get("conflictingSources") === "true") where.confidenceLevel = "CONFLICTING_SOURCES";
  return where;
}

export async function listMetadataSuggestions(userId: string, query: URLSearchParams) {
  await requireAiAdvisoryPermission(userId, "ai.metadata_suggestions.view", userId);
  const page = Math.max(1, Number(query.get("page") || 1)), pageSize = Math.min(100, Math.max(1, Number(query.get("pageSize") || 25))), sort = query.get("sort") || "newest";
  const orderBy: any = sort === "highest_confidence" ? { confidenceScore: "desc" } : sort === "lowest_confidence" ? { confidenceScore: "asc" } : sort === "oldest" ? { createdAt: "asc" } : sort === "most_affected_tracks" ? { affectedTrackCount: "desc" } : sort === "artist" ? { affectedArtistsJson: "asc" } : sort === "album" ? { affectedAlbumsJson: "asc" } : sort === "suggestion_type" ? { suggestionType: "asc" } : { createdAt: "desc" };
  const where = suggestionWhere(userId, query);
  const [rows, total] = await Promise.all([prisma.metadataSuggestion.findMany({ where, include: { tracks: { take: 10, orderBy: { id: "asc" } }, sources: true, reviews: { orderBy: { createdAt: "desc" }, take: 1 } }, orderBy, skip: (page - 1) * pageSize, take: pageSize }), prisma.metadataSuggestion.count({ where })]);
  return { suggestions: rows, pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) }, approvalMeaning: "Approved suggestion — not applied. Approval records agreement only and does not modify Plex, source-library metadata, embedded tags, filenames, or folders." };
}

export async function metadataSuggestionStats(userId: string) {
  await requireAiAdvisoryPermission(userId, "ai.metadata_suggestions.view", userId);
  const grouped = await prisma.metadataSuggestion.groupBy({ by: ["confidenceLevel", "status"], where: { ownerId: userId }, _count: { _all: true } });
  const result: Record<string, number> = { high: 0, medium: 0, low: 0, conflictingSources: 0, pending: 0, approvedNotApplied: 0 };
  for (const row of grouped) { const key = row.confidenceLevel === "HIGH" ? "high" : row.confidenceLevel === "MEDIUM" ? "medium" : row.confidenceLevel === "LOW" ? "low" : "conflictingSources"; result[key] += row._count._all; if (row.status === "PENDING" || row.status === "CONFLICT") result.pending += row._count._all; if (row.status === "APPROVED") result.approvedNotApplied += row._count._all; }
  const lastScan = await prisma.metadataAnalysisJob.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } }); return { ...result, lastScan, metadataWritesEnabled: false };
}

export async function getMetadataSuggestion(userId: string, suggestionId: string, page = 1, pageSize = 50) {
  const row = await prisma.metadataSuggestion.findUnique({ where: { id: suggestionId }, include: { sources: true, reviews: { include: { reviewer: { select: { id: true, username: true } } }, orderBy: { createdAt: "desc" } }, auditEvents: { orderBy: { createdAt: "desc" }, take: 100 } } });
  if (!row) throw fail("SUGGESTION_NOT_FOUND", "Metadata suggestion not found.", 404); await requireAiAdvisoryPermission(userId, "ai.metadata_suggestions.view", row.ownerId);
  const [tracks, totalTracks] = await Promise.all([prisma.metadataSuggestionTrack.findMany({ where: { suggestionId }, orderBy: { id: "asc" }, skip: (Math.max(1, page) - 1) * Math.min(100, pageSize), take: Math.min(100, pageSize) }), prisma.metadataSuggestionTrack.count({ where: { suggestionId } })]);
  return { suggestion: { ...row, tracks }, trackPagination: { page: Math.max(1, page), pageSize: Math.min(100, pageSize), total: totalTracks, pageCount: Math.ceil(totalTracks / Math.min(100, pageSize)) }, approvalMeaning: "Approved suggestion — not applied." };
}

const reviewTarget = (action: string) => action === "APPROVE" ? "APPROVED" : action === "REJECT" ? "REJECTED" : action === "IGNORE" ? "IGNORED" : action === "ARCHIVE" ? "ARCHIVED" : "PENDING";
export async function reviewMetadataSuggestion(userId: string, suggestionId: string, raw: unknown) {
  const input = reviewRequestSchema.parse(raw), row = await prisma.metadataSuggestion.findUnique({ where: { id: suggestionId } }); if (!row) throw fail("SUGGESTION_NOT_FOUND", "Metadata suggestion not found.", 404);
  await requireAiAdvisoryPermission(userId, "ai.metadata_suggestions.review", row.ownerId); assertMetadataWritesDisabled();
  if (input.action === "APPROVE" && input.confirmation !== "I understand this records a recommendation only and does not modify metadata.") throw fail("ADVISORY_CONFIRMATION_REQUIRED", "Confirm that approval records a recommendation only and does not modify metadata.", 409);
  const target = reviewTarget(input.action), now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.metadataSuggestion.update({ where: { id: suggestionId }, data: { status: target, reviewedAt: now, archivedAt: target === "ARCHIVED" ? now : input.action === "RESTORE" ? null : row.archivedAt } });
    await tx.metadataSuggestionReview.create({ data: { suggestionId, reviewerId: userId, previousStatus: row.status, newStatus: target, notes: input.notes } });
    await audit({ suggestionId, actorId: userId, action: `SUGGESTION_${input.action}`, objectType: "METADATA_SUGGESTION", objectId: suggestionId, libraryId: row.libraryId, playlistId: row.playlistId, suggestionCount: 1, affectedTrackCount: row.affectedTrackCount, previousStatus: row.status, newStatus: target, safeMetadata: { advisoryOnly: true, metadataWritesEnabled: false } }, tx);
    return next;
  });
  return { suggestion: updated, approvalMeaning: target === "APPROVED" ? "Approved suggestion — not applied." : undefined, metadataModified: false };
}

export async function bulkReviewMetadataSuggestions(userId: string, raw: unknown) {
  const input = bulkReviewRequestSchema.parse(raw); await requireAiAdvisoryPermission(userId, "ai.metadata_suggestions.review", userId); assertMetadataWritesDisabled();
  if (input.action === "APPROVE" && input.confirmation !== "I understand this records a recommendation only and does not modify metadata.") throw fail("ADVISORY_CONFIRMATION_REQUIRED", "Confirm that bulk approval records recommendations only and does not modify metadata.", 409);
  const ids = Array.from(new Set(input.suggestionIds)); const rows = await prisma.metadataSuggestion.findMany({ where: { id: { in: ids }, ownerId: userId } });
  if (rows.length !== ids.length) throw fail("SELECTION_SCOPE_MISMATCH", "One or more suggestions are unavailable or outside the current selection scope.", 409);
  const target = reviewTarget(input.action), bulkRequestId = crypto.randomUUID(), affectedTracks = rows.reduce((sum, row) => sum + row.affectedTrackCount, 0), now = new Date();
  await prisma.$transaction(async (tx) => {
    for (const row of rows) { await tx.metadataSuggestion.update({ where: { id: row.id }, data: { status: target, reviewedAt: now, archivedAt: target === "ARCHIVED" ? now : input.action === "RESTORE" ? null : row.archivedAt } }); await tx.metadataSuggestionReview.create({ data: { suggestionId: row.id, reviewerId: userId, previousStatus: row.status, newStatus: target, notes: input.notes, bulkRequestId } }); }
    await audit({ actorId: userId, action: `BULK_${input.action}`, objectType: "METADATA_SUGGESTION_SELECTION", objectId: bulkRequestId, requestOrJobId: bulkRequestId, suggestionCount: rows.length, affectedTrackCount: affectedTracks, newStatus: target, safeMetadata: { selectedSuggestionIds: ids, advisoryOnly: true, metadataWritesEnabled: false } }, tx);
  });
  return { bulkRequestId, suggestionCount: rows.length, affectedTrackCount: affectedTracks, newStatus: target, approvalMeaning: target === "APPROVED" ? "Approved suggestions — not applied." : undefined, metadataModified: false };
}

export async function listIgnoreRules(userId: string) { await requireAiAdvisoryPermission(userId, "ai.metadata_suggestions.manage_ignore_rules", userId); return prisma.metadataIgnoreRule.findMany({ where: { creatorId: userId }, orderBy: { createdAt: "desc" } }); }
export async function createIgnoreRule(userId: string, raw: unknown) { await requireAiAdvisoryPermission(userId, "ai.metadata_suggestions.manage_ignore_rules", userId); const input = createIgnoreRuleSchema.parse(raw); const row = await prisma.metadataIgnoreRule.create({ data: { creatorId: userId, scope: input.scope, description: input.description, matchJson: json(input.match) } }); await audit({ actorId: userId, action: "IGNORE_RULE_CREATED", objectType: "METADATA_IGNORE_RULE", objectId: row.id, safeMetadata: { scope: row.scope } }); return row; }
export async function updateIgnoreRule(userId: string, ruleId: string, raw: unknown) { const input = updateIgnoreRuleSchema.parse(raw), row = await prisma.metadataIgnoreRule.findUnique({ where: { id: ruleId } }); if (!row) throw fail("IGNORE_RULE_NOT_FOUND", "Ignore rule not found.", 404); await requireAiAdvisoryPermission(userId, "ai.metadata_suggestions.manage_ignore_rules", row.creatorId); const updated = await prisma.metadataIgnoreRule.update({ where: { id: ruleId }, data: { enabled: input.enabled, disabledAt: input.enabled ? null : new Date() } }); await audit({ actorId: userId, action: input.enabled ? "IGNORE_RULE_ENABLED" : "IGNORE_RULE_DISABLED", objectType: "METADATA_IGNORE_RULE", objectId: ruleId }); return updated; }
export async function deleteIgnoreRule(userId: string, ruleId: string) { const row = await prisma.metadataIgnoreRule.findUnique({ where: { id: ruleId } }); if (!row) throw fail("IGNORE_RULE_NOT_FOUND", "Ignore rule not found.", 404); await requireAiAdvisoryPermission(userId, "ai.metadata_suggestions.manage_ignore_rules", row.creatorId); await audit({ actorId: userId, action: "IGNORE_RULE_DELETED", objectType: "METADATA_IGNORE_RULE", objectId: ruleId, safeMetadata: { scope: row.scope, suppressedCount: row.suppressedCount } }); await prisma.metadataIgnoreRule.delete({ where: { id: ruleId } }); return { deleted: true, historicalSuggestionsPreserved: true }; }

const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""').replace(/[\r\n]+/g, " ")}"`;
export async function exportMetadataSuggestions(userId: string, raw: unknown) {
  await requireAiAdvisoryPermission(userId, "ai.metadata_suggestions.export", userId); const input = exportRequestSchema.parse(raw);
  const rows = await prisma.metadataSuggestion.findMany({ where: { ownerId: userId, ...(input.suggestionIds?.length ? { id: { in: Array.from(new Set(input.suggestionIds)) } } : {}) }, include: { tracks: true, sources: true, reviews: { orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: { createdAt: "desc" }, take: 10000 });
  if (input.suggestionIds?.length && rows.length !== new Set(input.suggestionIds).size) throw fail("EXPORT_SCOPE_MISMATCH", "One or more selected suggestions are unavailable.", 409);
  const safe = rows.map((row) => ({ suggestionId: row.id, suggestionType: row.suggestionType, field: row.field, existingValue: row.existingValue, suggestedValue: row.suggestedValue, reason: row.reason, confidenceScore: row.confidenceScore, confidenceLevel: row.confidenceLevel, status: row.status, affectedTrackCount: row.affectedTrackCount, trackIdentifiers: row.tracks.map((track) => track.trackIdentifier), artists: row.affectedArtistsJson, albums: row.affectedAlbumsJson, sourceValues: row.sources.map((source) => ({ source: source.sourceType, available: source.available, queried: source.queried, value: source.valueJson })), conflict: Boolean(row.conflictingSourceJson), plexImpact: row.plexImpact, sourceLibraryImpact: row.sourceLibraryImpact, embeddedTagImpact: row.embeddedTagImpact, createdAt: row.createdAt, reviewedAt: row.reviewedAt, reviewerNotes: row.reviews[0]?.notes || null, approvalMeaning: row.status === "APPROVED" ? "Approved suggestion — not applied" : null }));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-"); const filename = `mixarr-metadata-suggestions-${stamp}.${input.format === "CSV" ? "csv" : "json"}`;
  const content = input.format === "JSON" ? JSON.stringify({ schemaVersion: "1.0", advisoryOnly: true, metadataWritesEnabled: false, suggestions: safe }, null, 2) : [Object.keys(safe[0] || { suggestionId: "" }).map(csvCell).join(","), ...safe.map((row) => Object.values(row).map((value) => csvCell(typeof value === "object" ? JSON.stringify(value) : value)).join(","))].join("\r\n");
  const affectedTrackCount = rows.reduce((sum, row) => sum + row.affectedTrackCount, 0); const record = await prisma.metadataSuggestionExport.create({ data: { exporterId: userId, format: input.format, filename, filterJson: json(input.filters || {}), suggestionCount: rows.length, affectedTrackCount } });
  await audit({ actorId: userId, action: "REPORT_EXPORTED", objectType: "METADATA_SUGGESTION_EXPORT", objectId: record.id, suggestionCount: rows.length, affectedTrackCount, safeMetadata: { format: input.format, filename } });
  return { filename, contentType: input.format === "CSV" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8", content, suggestionCount: rows.length };
}
