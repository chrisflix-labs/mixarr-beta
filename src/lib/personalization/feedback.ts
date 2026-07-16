import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../prisma";
import { artistFeedbackAdjustment, playlistFitAdjustment, trackFeedbackAdjustment, transitionPairKey } from "./feedbackRules";
import type { ArtistFeedbackState, ExplicitFeedbackScoringContext, PlaylistFitState, TrackFeedbackState } from "./types";
import { markAdaptiveScoringDirty } from "../adaptiveScoring";

export const FEEDBACK_REASONS = ["WRONG_MOOD", "TOO_REPETITIVE", "BAD_BPM_TRANSITION", "ARTIST_OVERREPRESENTED", "DISLIKED_TRACK", "POOR_PLAYLIST_FIT", "OTHER"] as const;
export const FEEDBACK_SOURCES = ["PLAYLIST_PREVIEW", "GENERATED_PLAYLIST_DETAILS", "TRACK_TABLE", "LIBRARY_SEARCH", "REGENERATION_PREVIEW", "BULK_ACTION", "RECENTLY_ADDED_DISCOVERY", "API"] as const;
export const trackFeedbackInputSchema = z.object({
  trackId: z.string().uuid(), state: z.enum(["LIKED", "DISLIKED", "NEVER_RECOMMEND"]),
  reason: z.enum(FEEDBACK_REASONS).nullable().optional(), note: z.string().trim().max(240).nullable().optional(),
  sourceSurface: z.enum(FEEDBACK_SOURCES).default("API"), playlistId: z.string().uuid().nullable().optional(),
  generationId: z.string().max(120).nullable().optional(), engineVersion: z.string().max(40).nullable().optional(), idempotencyKey: z.string().max(160).nullable().optional(),
});
export const artistFeedbackInputSchema = z.object({
  artistId: z.string().uuid(), state: z.enum(["PREFER", "RECOMMEND_LESS"]), sourceSurface: z.enum(FEEDBACK_SOURCES).default("API"),
  playlistId: z.string().uuid().nullable().optional(), reason: z.enum(FEEDBACK_REASONS).nullable().optional(), note: z.string().trim().max(240).nullable().optional(),
  idempotencyKey: z.string().max(160).nullable().optional(),
});
export const playlistFitInputSchema = z.object({
  trackId: z.string().uuid(), playlistId: z.string().uuid().nullable().optional(), state: z.enum(["GOOD_FIT", "POOR_FIT"]),
  reason: z.enum(FEEDBACK_REASONS).nullable().optional(), note: z.string().trim().max(240).nullable().optional(), sourceSurface: z.enum(FEEDBACK_SOURCES).default("API"),
  generationId: z.string().max(120).nullable().optional(), engineVersion: z.string().max(40).nullable().optional(), idempotencyKey: z.string().max(160).nullable().optional(),
}).superRefine((value, context) => { if (!value.playlistId && !value.generationId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["playlistId"], message: "Playlist or preview context is required." }); });
const finite = z.number().finite().nullable().optional();
export const transitionFeedbackInputSchema = z.object({
  playlistId: z.string().uuid().nullable().optional(), previousTrackId: z.string().uuid(), currentTrackId: z.string().uuid(), nextTrackId: z.string().uuid().nullable().optional(),
  transitionPosition: z.number().int().min(1).max(100000).nullable().optional(), reason: z.enum(FEEDBACK_REASONS).nullable().optional(), note: z.string().trim().max(240).nullable().optional(),
  sourceSurface: z.enum(FEEDBACK_SOURCES).default("API"), generationId: z.string().max(120).nullable().optional(), engineVersion: z.string().max(40).nullable().optional(),
  idempotencyKey: z.string().max(160).nullable().optional(), context: z.object({ previousBpm: finite, currentBpm: finite, nextBpm: finite, previousEffectiveBpm: finite, currentEffectiveBpm: finite, nextEffectiveBpm: finite, previousMood: finite, currentMood: finite, nextMood: finite, previousEnergy: finite, currentEnergy: finite, nextEnergy: finite, transitionScore: finite }).strict().nullable().optional(),
});

const bulkActionSchema = z.enum(["LIKE_TRACKS", "DISLIKE_TRACKS", "NEVER_RECOMMEND_TRACKS", "CLEAR_TRACK_FEEDBACK", "GOOD_PLAYLIST_FIT", "POOR_PLAYLIST_FIT", "PREFER_ARTISTS", "RECOMMEND_LESS_ARTISTS"]);
export const bulkFeedbackInputSchema = z.object({
  action: bulkActionSchema, trackIds: z.array(z.string().uuid()).min(1).max(50000), playlistId: z.string().uuid().nullable().optional(),
  reason: z.enum(FEEDBACK_REASONS).nullable().optional(), note: z.string().trim().max(240).nullable().optional(), sourceSurface: z.literal("BULK_ACTION").default("BULK_ACTION"),
  confirmNeverRecommend: z.boolean().optional(),
}).superRefine((value, context) => {
  if (value.action === "NEVER_RECOMMEND_TRACKS" && value.confirmNeverRecommend !== true) context.addIssue({ code: z.ZodIssueCode.custom, path: ["confirmNeverRecommend"], message: "Confirm bulk never-recommend before continuing." });
  if (["GOOD_PLAYLIST_FIT", "POOR_PLAYLIST_FIT"].includes(value.action) && !value.playlistId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["playlistId"], message: "Playlist context is required for playlist-fit feedback." });
});

async function ownedTrack(userId: string, trackId: string) {
  return prisma.track.findFirst({ where: { id: trackId, library: { server: { userId } } }, select: { id: true, artistId: true } });
}
async function ownedArtist(userId: string, artistId: string) {
  return prisma.artist.findFirst({ where: { id: artistId, library: { server: { userId } } }, select: { id: true } });
}
async function playlistScope(userId: string, playlistId?: string | null) {
  if (!playlistId) return { playlistId: null, playlistProfileId: null, scopeKey: null };
  const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: playlistId, userId }, select: { id: true, engineVersion: true, preferenceProfile: { select: { id: true } } } });
  if (!playlist) throw new Error("Playlist not found");
  return { playlistId: playlist.id, playlistProfileId: playlist.preferenceProfile?.id || null, scopeKey: playlist.preferenceProfile ? `profile:${playlist.preferenceProfile.id}` : `playlist:${playlist.id}`, engineVersion: playlist.engineVersion };
}
function eventData(userId: string, input: { feedbackType: string; targetType: string; targetIds: Record<string, string | null | undefined>; previousState?: string | null; newState?: string | null; reason?: string | null; note?: string | null; sourceSurface: string; playlistId?: string | null; playlistProfileId?: string | null; generationId?: string | null; engineVersion?: string | null; context?: unknown; idempotencyKey?: string | null }) {
  return { userId, feedbackType: input.feedbackType, targetType: input.targetType, targetIdsJson: input.targetIds as Prisma.InputJsonValue, previousState: input.previousState || undefined, newState: input.newState || undefined, reason: input.reason || undefined, note: input.note || undefined, sourceSurface: input.sourceSurface, playlistId: input.playlistId || undefined, playlistProfileId: input.playlistProfileId || undefined, generationId: input.generationId || undefined, engineVersion: input.engineVersion || undefined, contextJson: input.context ? input.context as Prisma.InputJsonValue : undefined, idempotencyKey: input.idempotencyKey ? `${userId}:${input.idempotencyKey}` : undefined };
}

export async function setTrackFeedback(userId: string, raw: unknown) {
  const input = trackFeedbackInputSchema.parse(raw);
  if (!(await ownedTrack(userId, input.trackId))) throw new Error("Track not found");
  const scope = await playlistScope(userId, input.playlistId);
  const existing = await prisma.userTrackPreference.findUnique({ where: { userId_trackId: { userId, trackId: input.trackId } } });
  if (existing?.state === input.state) return { preference: existing, unchanged: true };
  const preference = await prisma.$transaction(async (tx) => {
    const event = await tx.feedbackEvent.create({ data: eventData(userId, { feedbackType: "TRACK_PREFERENCE", targetType: "TRACK", targetIds: { trackId: input.trackId }, previousState: existing?.state, newState: input.state, ...input, ...scope, engineVersion: input.engineVersion || scope.engineVersion }) });
    return tx.userTrackPreference.upsert({ where: { userId_trackId: { userId, trackId: input.trackId } }, create: { userId, trackId: input.trackId, state: input.state, scoreAdjustment: trackFeedbackAdjustment(input.state), lastFeedbackEventId: event.id }, update: { state: input.state, scoreAdjustment: trackFeedbackAdjustment(input.state), lastFeedbackEventId: event.id } });
  });
  await markAdaptiveScoringDirty(userId);
  return { preference, unchanged: false };
}

export async function clearTrackFeedback(userId: string, trackId: string, sourceSurface = "API") {
  if (!(await ownedTrack(userId, trackId))) throw new Error("Track not found");
  const existing = await prisma.userTrackPreference.findUnique({ where: { userId_trackId: { userId, trackId } } });
  if (!existing) return { state: "NEUTRAL", unchanged: true };
  await prisma.$transaction(async (tx) => {
    await tx.feedbackEvent.create({ data: eventData(userId, { feedbackType: "TRACK_PREFERENCE_CLEARED", targetType: "TRACK", targetIds: { trackId }, previousState: existing.state, newState: "NEUTRAL", sourceSurface }) });
    await tx.userTrackPreference.delete({ where: { userId_trackId: { userId, trackId } } });
  });
  await markAdaptiveScoringDirty(userId);
  return { state: "NEUTRAL", unchanged: false };
}

export async function setArtistFeedback(userId: string, raw: unknown) {
  const input = artistFeedbackInputSchema.parse(raw);
  if (!(await ownedArtist(userId, input.artistId))) throw new Error("Artist not found");
  const scope = await playlistScope(userId, input.playlistId);
  const existing = await prisma.userArtistPreference.findUnique({ where: { userId_artistId: { userId, artistId: input.artistId } } });
  if (existing?.state === input.state) return { preference: existing, unchanged: true };
  const preference = await prisma.$transaction(async (tx) => {
    const event = await tx.feedbackEvent.create({ data: eventData(userId, { feedbackType: "ARTIST_PREFERENCE", targetType: "ARTIST", targetIds: { artistId: input.artistId }, previousState: existing?.state, newState: input.state, ...input, ...scope }) });
    return tx.userArtistPreference.upsert({ where: { userId_artistId: { userId, artistId: input.artistId } }, create: { userId, artistId: input.artistId, state: input.state, scoreAdjustment: artistFeedbackAdjustment(input.state), lastFeedbackEventId: event.id }, update: { state: input.state, scoreAdjustment: artistFeedbackAdjustment(input.state), lastFeedbackEventId: event.id } });
  });
  await markAdaptiveScoringDirty(userId);
  return { preference, unchanged: false };
}

export async function clearArtistFeedback(userId: string, artistId: string, sourceSurface = "API") {
  if (!(await ownedArtist(userId, artistId))) throw new Error("Artist not found");
  const existing = await prisma.userArtistPreference.findUnique({ where: { userId_artistId: { userId, artistId } } });
  if (!existing) return { state: "NEUTRAL", unchanged: true };
  await prisma.$transaction(async (tx) => {
    await tx.feedbackEvent.create({ data: eventData(userId, { feedbackType: "ARTIST_PREFERENCE_CLEARED", targetType: "ARTIST", targetIds: { artistId }, previousState: existing.state, newState: "NEUTRAL", sourceSurface }) });
    await tx.userArtistPreference.delete({ where: { userId_artistId: { userId, artistId } } });
  });
  await markAdaptiveScoringDirty(userId);
  return { state: "NEUTRAL", unchanged: false };
}

export async function setPlaylistFitFeedback(userId: string, raw: unknown) {
  const input = playlistFitInputSchema.parse(raw);
  if (!(await ownedTrack(userId, input.trackId))) throw new Error("Track not found");
  const scope = await playlistScope(userId, input.playlistId);
  const scopeKey = scope.scopeKey || `generation:${input.generationId}`;
  const key = { userId_trackId_scopeKey: { userId, trackId: input.trackId, scopeKey } };
  const existing = await prisma.playlistFitFeedback.findUnique({ where: key });
  if (existing?.state === input.state && existing.reason === (input.reason || null) && existing.note === (input.note || null)) return { feedback: existing, unchanged: true };
  const feedback = await prisma.$transaction(async (tx) => {
    const event = await tx.feedbackEvent.create({ data: eventData(userId, { feedbackType: "PLAYLIST_FIT", targetType: "TRACK_PLAYLIST_SCOPE", targetIds: { trackId: input.trackId, playlistId: scope.playlistId, playlistProfileId: scope.playlistProfileId }, previousState: existing?.state, newState: input.state, ...input, ...scope, engineVersion: input.engineVersion || scope.engineVersion }) });
    const data = { state: input.state, reason: input.reason || null, note: input.note || null, generationId: input.generationId || null, engineVersion: input.engineVersion || scope.engineVersion || null, playlistId: scope.playlistId, playlistProfileId: scope.playlistProfileId, lastFeedbackEventId: event.id };
    return tx.playlistFitFeedback.upsert({ where: key, create: { userId, trackId: input.trackId, scopeKey, ...data }, update: data });
  });
  if (scope.playlistId) {
    const identity = await import("../playlistIdentity");
    if (input.state === "POOR_FIT") {
      await identity.rememberPlaylistRejection({ userId, playlistId: scope.playlistId, trackId: input.trackId, reason: input.reason, source: input.sourceSurface, strong: true, eventKey: `feedback:${feedback.lastFeedbackEventId}` });
    } else {
      await identity.recordPlaylistIdentityEvent({ userId, playlistId: scope.playlistId, trackId: input.trackId, eventType: "GOOD_PLAYLIST_FIT", eventSource: input.sourceSurface, eventKey: `feedback:${feedback.lastFeedbackEventId}`, feedbackReason: input.reason });
    }
  }
  await markAdaptiveScoringDirty(userId);
  return { feedback, unchanged: false };
}

export async function clearPlaylistFitFeedback(userId: string, feedbackId: string, sourceSurface = "API") {
  const existing = await prisma.playlistFitFeedback.findFirst({ where: { id: feedbackId, userId } });
  if (!existing) return { cleared: false };
  await prisma.$transaction(async (tx) => {
    await tx.feedbackEvent.create({ data: eventData(userId, { feedbackType: "PLAYLIST_FIT_CLEARED", targetType: "TRACK_PLAYLIST_SCOPE", targetIds: { trackId: existing.trackId, playlistId: existing.playlistId, playlistProfileId: existing.playlistProfileId }, previousState: existing.state, newState: "NEUTRAL", sourceSurface, playlistId: existing.playlistId, playlistProfileId: existing.playlistProfileId }) });
    await tx.playlistFitFeedback.delete({ where: { id: existing.id } });
  });
  await markAdaptiveScoringDirty(userId);
  return { cleared: true };
}

export async function recordPoorTransition(userId: string, raw: unknown) {
  const input = transitionFeedbackInputSchema.parse(raw);
  const ids = [input.previousTrackId, input.currentTrackId, input.nextTrackId].filter(Boolean) as string[];
  const owned = await prisma.track.count({ where: { id: { in: ids }, library: { server: { userId } } } });
  if (owned !== new Set(ids).size) throw new Error("One or more tracks were not found");
  const scope = await playlistScope(userId, input.playlistId);
  if (input.idempotencyKey) {
    const event = await prisma.feedbackEvent.findUnique({ where: { idempotencyKey: `${userId}:${input.idempotencyKey}` } });
    if (event) return { feedback: null, event, unchanged: true };
  }
  const result = await prisma.$transaction(async (tx) => {
    const event = await tx.feedbackEvent.create({ data: eventData(userId, { feedbackType: "POOR_TRANSITION", targetType: "TRACK_PAIR", targetIds: { previousTrackId: input.previousTrackId, currentTrackId: input.currentTrackId, nextTrackId: input.nextTrackId }, previousState: null, newState: "POOR_TRANSITION", ...input, ...scope, engineVersion: input.engineVersion || scope.engineVersion, context: input.context }) });
    const feedback = await tx.transitionFeedback.create({ data: { userId, playlistId: scope.playlistId, playlistProfileId: scope.playlistProfileId, previousTrackId: input.previousTrackId, currentTrackId: input.currentTrackId, nextTrackId: input.nextTrackId || null, reason: input.reason || null, note: input.note || null, transitionPosition: input.transitionPosition || null, generationId: input.generationId || null, engineVersion: input.engineVersion || scope.engineVersion || null, contextJson: input.context ? input.context as Prisma.InputJsonValue : undefined, feedbackEventId: event.id } });
    return { feedback, event };
  });
  await markAdaptiveScoringDirty(userId);
  return { ...result, unchanged: false };
}

export async function clearTransitionFeedback(userId: string, feedbackId: string, sourceSurface = "API") {
  const existing = await prisma.transitionFeedback.findFirst({ where: { id: feedbackId, userId } });
  if (!existing) return { cleared: false };
  await prisma.$transaction(async (tx) => {
    await tx.feedbackEvent.create({ data: eventData(userId, { feedbackType: "POOR_TRANSITION_CLEARED", targetType: "TRACK_PAIR", targetIds: { previousTrackId: existing.previousTrackId, currentTrackId: existing.currentTrackId }, previousState: existing.state, newState: "NEUTRAL", sourceSurface, playlistId: existing.playlistId, playlistProfileId: existing.playlistProfileId }) });
    await tx.transitionFeedback.delete({ where: { id: existing.id } });
  });
  await markAdaptiveScoringDirty(userId);
  return { cleared: true };
}

function chunks<T>(items: T[], size = 250) { const result: T[][] = []; for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size)); return result; }

export async function applyBulkFeedback(userId: string, raw: unknown) {
  const input = bulkFeedbackInputSchema.parse(raw);
  const ids = Array.from(new Set(input.trackIds));
  const failures: Array<{ trackId?: string; chunk: number; error: string }> = [];
  let affectedTracks = 0;
  let affectedArtists = 0;
  const bulkScope = input.playlistId ? await playlistScope(userId, input.playlistId) : null;
  const batches = chunks<string>(ids);
  for (let chunkIndex = 0; chunkIndex < batches.length; chunkIndex += 1) {
    const trackIds: string[] = batches[chunkIndex];
    try {
      const tracks = await prisma.track.findMany({ where: { id: { in: trackIds }, library: { server: { userId } } }, select: { id: true, artistId: true } });
      const missing = trackIds.filter((id) => !tracks.some((track) => track.id === id));
      failures.push(...missing.map((trackId) => ({ trackId, chunk: chunkIndex, error: "Track not found" })));
      if (input.action === "PREFER_ARTISTS" || input.action === "RECOMMEND_LESS_ARTISTS") {
        const artistIds = Array.from(new Set(tracks.map((track) => track.artistId)));
        const state: ArtistFeedbackState = input.action === "PREFER_ARTISTS" ? "PREFER" : "RECOMMEND_LESS";
        const existing = await prisma.userArtistPreference.findMany({ where: { userId, artistId: { in: artistIds } }, select: { artistId: true, state: true } });
        const changed = artistIds.filter((artistId) => existing.find((row) => row.artistId === artistId)?.state !== state);
        await prisma.$transaction(async (tx) => {
          if (changed.length) await tx.feedbackEvent.createMany({ data: changed.map((artistId) => eventData(userId, { feedbackType: "ARTIST_PREFERENCE", targetType: "ARTIST", targetIds: { artistId }, previousState: existing.find((row) => row.artistId === artistId)?.state, newState: state, sourceSurface: "BULK_ACTION", reason: input.reason, note: input.note })) });
          await tx.userArtistPreference.createMany({ data: artistIds.map((artistId) => ({ userId, artistId, state, scoreAdjustment: artistFeedbackAdjustment(state) })), skipDuplicates: true });
          await tx.userArtistPreference.updateMany({ where: { userId, artistId: { in: artistIds } }, data: { state, scoreAdjustment: artistFeedbackAdjustment(state) } });
        });
        affectedArtists += changed.length;
      } else if (input.action === "GOOD_PLAYLIST_FIT" || input.action === "POOR_PLAYLIST_FIT") {
        const state: PlaylistFitState = input.action === "GOOD_PLAYLIST_FIT" ? "GOOD_FIT" : "POOR_FIT";
        const scopeKey = bulkScope?.scopeKey; if (!scopeKey) throw new Error("Playlist context is required");
        const ownedIds = tracks.map((track) => track.id);
        const existing = await prisma.playlistFitFeedback.findMany({ where: { userId, trackId: { in: ownedIds }, scopeKey }, select: { trackId: true, state: true } });
        const changed = ownedIds.filter((trackId) => existing.find((row) => row.trackId === trackId)?.state !== state);
        await prisma.$transaction(async (tx) => {
          if (changed.length) await tx.feedbackEvent.createMany({ data: changed.map((trackId) => eventData(userId, { feedbackType: "PLAYLIST_FIT", targetType: "TRACK_PLAYLIST_SCOPE", targetIds: { trackId, playlistId: bulkScope?.playlistId, playlistProfileId: bulkScope?.playlistProfileId }, previousState: existing.find((row) => row.trackId === trackId)?.state, newState: state, sourceSurface: "BULK_ACTION", reason: input.reason, note: input.note, playlistId: bulkScope?.playlistId, playlistProfileId: bulkScope?.playlistProfileId })) });
          await tx.playlistFitFeedback.createMany({ data: ownedIds.map((trackId) => ({ userId, trackId, scopeKey, playlistId: bulkScope?.playlistId, playlistProfileId: bulkScope?.playlistProfileId, state, reason: input.reason || null, note: input.note || null, engineVersion: bulkScope?.engineVersion || null })), skipDuplicates: true });
          await tx.playlistFitFeedback.updateMany({ where: { userId, trackId: { in: ownedIds }, scopeKey }, data: { state, reason: input.reason || null, note: input.note || null } });
        });
        affectedTracks += changed.length;
      } else if (input.action === "CLEAR_TRACK_FEEDBACK") {
        const ownedIds = tracks.map((track) => track.id); const existing = await prisma.userTrackPreference.findMany({ where: { userId, trackId: { in: ownedIds } }, select: { trackId: true, state: true } });
        await prisma.$transaction(async (tx) => { if (existing.length) await tx.feedbackEvent.createMany({ data: existing.map((row) => eventData(userId, { feedbackType: "TRACK_PREFERENCE_CLEARED", targetType: "TRACK", targetIds: { trackId: row.trackId }, previousState: row.state, newState: "NEUTRAL", sourceSurface: "BULK_ACTION" })) }); await tx.userTrackPreference.deleteMany({ where: { userId, trackId: { in: ownedIds } } }); });
        affectedTracks += existing.length;
      } else {
        const state: TrackFeedbackState = input.action === "LIKE_TRACKS" ? "LIKED" : input.action === "DISLIKE_TRACKS" ? "DISLIKED" : "NEVER_RECOMMEND";
        const ownedIds = tracks.map((track) => track.id); const existing = await prisma.userTrackPreference.findMany({ where: { userId, trackId: { in: ownedIds } }, select: { trackId: true, state: true } }); const changed = ownedIds.filter((trackId) => existing.find((row) => row.trackId === trackId)?.state !== state);
        await prisma.$transaction(async (tx) => { if (changed.length) await tx.feedbackEvent.createMany({ data: changed.map((trackId) => eventData(userId, { feedbackType: "TRACK_PREFERENCE", targetType: "TRACK", targetIds: { trackId }, previousState: existing.find((row) => row.trackId === trackId)?.state, newState: state, sourceSurface: "BULK_ACTION", reason: input.reason, note: input.note })) }); await tx.userTrackPreference.createMany({ data: ownedIds.map((trackId) => ({ userId, trackId, state, scoreAdjustment: trackFeedbackAdjustment(state) })), skipDuplicates: true }); await tx.userTrackPreference.updateMany({ where: { userId, trackId: { in: ownedIds } }, data: { state, scoreAdjustment: trackFeedbackAdjustment(state) } }); });
        affectedTracks += changed.length;
      }
    } catch (error) {
      failures.push({ chunk: chunkIndex, error: error instanceof Error ? error.message : "Bulk chunk failed" });
    }
  }
  console.info("[PersonalizationFeedback:Bulk]", { userId, action: input.action, requested: ids.length, affectedTracks, affectedArtists, failures: failures.length });
  await markAdaptiveScoringDirty(userId);
  return { requested: ids.length, affectedTracks, affectedArtists, failures, partialFailure: failures.length > 0 };
}

export async function getFeedbackState(userId: string, trackIds: string[], playlistId?: string | null) {
  const ids = Array.from(new Set(trackIds)).slice(0, 5000);
  const scope = await playlistScope(userId, playlistId);
  const owned = await prisma.track.findMany({ where: { id: { in: ids }, library: { server: { userId } } }, select: { id: true, artistId: true } });
  const ownedIds = owned.map((track) => track.id);
  const artistIds = Array.from(new Set(owned.map((track) => track.artistId)));
  const [trackPreferences, artistPreferences, playlistFits, transitions] = await Promise.all([
    prisma.userTrackPreference.findMany({ where: { userId, trackId: { in: ownedIds } } }),
    prisma.userArtistPreference.findMany({ where: { userId, artistId: { in: artistIds } } }),
    scope.scopeKey ? prisma.playlistFitFeedback.findMany({ where: { userId, trackId: { in: ownedIds }, scopeKey: scope.scopeKey } }) : Promise.resolve([]),
    playlistId ? prisma.transitionFeedback.findMany({ where: { userId, playlistId, previousTrackId: { in: ownedIds }, currentTrackId: { in: ownedIds } }, orderBy: { createdAt: "desc" }, take: 1000 }) : Promise.resolve([]),
  ]);
  return { trackPreferences: Object.fromEntries(trackPreferences.map((row) => [row.trackId, row])), artistPreferences: Object.fromEntries(artistPreferences.map((row) => [row.artistId, row])), playlistFits: Object.fromEntries(playlistFits.map((row) => [row.trackId, row])), poorTransitions: transitions.map((row) => ({ ...row, pairKey: transitionPairKey(row.previousTrackId, row.currentTrackId) })), scope };
}

export async function loadExplicitFeedbackScoringContext(userId: string, trackIds: string[], artistIds: string[], playlistId?: string | null): Promise<ExplicitFeedbackScoringContext> {
  const scope = await playlistScope(userId, playlistId);
  const uniqueTracks = Array.from(new Set(trackIds)); const uniqueArtists = Array.from(new Set(artistIds));
  const [trackRows, artistRows, fitRows, transitionRows] = await Promise.all([
    prisma.userTrackPreference.findMany({ where: { userId, trackId: { in: uniqueTracks } }, select: { trackId: true, state: true, scoreAdjustment: true } }),
    prisma.userArtistPreference.findMany({ where: { userId, artistId: { in: uniqueArtists } }, select: { artistId: true, state: true, scoreAdjustment: true } }),
    scope.scopeKey ? prisma.playlistFitFeedback.findMany({ where: { userId, trackId: { in: uniqueTracks }, scopeKey: scope.scopeKey }, select: { trackId: true, state: true, reason: true } }) : Promise.resolve([]),
    scope.playlistId || scope.playlistProfileId ? prisma.transitionFeedback.findMany({ where: { userId, previousTrackId: { in: uniqueTracks }, currentTrackId: { in: uniqueTracks }, OR: [...(scope.playlistId ? [{ playlistId: scope.playlistId }] : []), ...(scope.playlistProfileId ? [{ playlistProfileId: scope.playlistProfileId }] : [])] }, orderBy: { createdAt: "desc" }, take: 2000, select: { previousTrackId: true, currentTrackId: true, reason: true, contextJson: true } }) : Promise.resolve([]),
  ]);
  const context: ExplicitFeedbackScoringContext = {
    trackPreferences: Object.fromEntries(trackRows.map((row) => [row.trackId, { state: row.state as TrackFeedbackState, adjustment: row.scoreAdjustment }])),
    artistPreferences: Object.fromEntries(artistRows.map((row) => [row.artistId, { state: row.state as ArtistFeedbackState, adjustment: row.scoreAdjustment }])),
    playlistFits: Object.fromEntries(fitRows.map((row) => [row.trackId, { state: row.state as PlaylistFitState, adjustment: playlistFitAdjustment(row.state as PlaylistFitState), reason: row.reason }])),
    transitionPenalties: Object.fromEntries(transitionRows.map((row) => [transitionPairKey(row.previousTrackId, row.currentTrackId), { adjustment: -14, reason: row.reason, context: row.contextJson as Record<string, unknown> | null }])),
    hardExcludedTrackIds: trackRows.filter((row) => row.state === "NEVER_RECOMMEND").map((row) => row.trackId), playlistId: scope.playlistId, playlistProfileId: scope.playlistProfileId,
  };
  console.info("[PersonalizationFeedback]", { userId, candidates: uniqueTracks.length, liked: trackRows.filter((r) => r.state === "LIKED").length, disliked: trackRows.filter((r) => r.state === "DISLIKED").length, excluded: context.hardExcludedTrackIds.length, artistPrefs: artistRows.length, playlistFits: fitRows.length, transitionRules: transitionRows.length });
  return context;
}

export async function getFeedbackManagement(userId: string, input: { page?: number; pageSize?: number; type?: string; query?: string } = {}) {
  const page = Math.max(1, input.page || 1); const pageSize = Math.min(100, Math.max(1, input.pageSize || 25)); const skip = (page - 1) * pageSize;
  const type = input.type || "tracks"; const query = input.query?.trim();
  if (type === "artists") {
    const where = { userId, ...(query ? { artist: { title: { contains: query, mode: "insensitive" as const } } } : {}) };
    const [items, total] = await Promise.all([prisma.userArtistPreference.findMany({ where, include: { artist: { select: { id: true, title: true } } }, orderBy: { updatedAt: "desc" }, skip, take: pageSize }), prisma.userArtistPreference.count({ where })]);
    return { type, items, total, page, pageSize };
  }
  if (type === "fits") {
    const where = { userId, ...(query ? { track: { OR: [{ title: { contains: query, mode: "insensitive" as const } }, { artist: { title: { contains: query, mode: "insensitive" as const } } }] } } : {}) };
    const [items, total] = await Promise.all([prisma.playlistFitFeedback.findMany({ where, include: { track: { select: { id: true, title: true, artist: { select: { title: true } } } }, playlist: { select: { plexPlaylistTitle: true } }, playlistProfile: { select: { name: true } } }, orderBy: { updatedAt: "desc" }, skip, take: pageSize }), prisma.playlistFitFeedback.count({ where })]);
    return { type, items, total, page, pageSize };
  }
  if (type === "transitions") {
    const where = { userId, ...(query ? { OR: [{ previousTrack: { title: { contains: query, mode: "insensitive" as const } } }, { currentTrack: { title: { contains: query, mode: "insensitive" as const } } }] } : {}) };
    const [items, total] = await Promise.all([prisma.transitionFeedback.findMany({ where, include: { previousTrack: { select: { id: true, title: true, artist: { select: { title: true } } } }, currentTrack: { select: { id: true, title: true, artist: { select: { title: true } } } }, playlist: { select: { plexPlaylistTitle: true } } }, orderBy: { createdAt: "desc" }, skip, take: pageSize }), prisma.transitionFeedback.count({ where })]);
    return { type, items, total, page, pageSize };
  }
  const where = { userId, ...(query ? { track: { OR: [{ title: { contains: query, mode: "insensitive" as const } }, { artist: { title: { contains: query, mode: "insensitive" as const } } }] } } : {}) };
  const [items, total] = await Promise.all([prisma.userTrackPreference.findMany({ where, include: { track: { select: { id: true, title: true, artist: { select: { id: true, title: true } } } } }, orderBy: { updatedAt: "desc" }, skip, take: pageSize }), prisma.userTrackPreference.count({ where })]);
  return { type, items, total, page, pageSize };
}
