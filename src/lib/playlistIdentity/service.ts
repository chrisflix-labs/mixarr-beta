import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../prisma";
import { safeFinishJobHistory, safeRecordJobHistory, safeStartJobHistory } from "../jobHistory";
import { calculatePlaylistIdentityProfile, confidenceForIdentity, mergeIdentityProfiles } from "./profile";
import type { IdentityAttributeState, PlaylistIdentityMode, PlaylistIdentityProfile, PlaylistIdentityScoringContext, WeightedIdentityTrack } from "./types";
import { PLAYLIST_IDENTITY_MODES, PLAYLIST_IDENTITY_SCHEMA_VERSION } from "./types";

const profileKeys = [
  "coreMoods", "secondaryMoods", "moodDistribution", "averageEnergy", "energyRange", "energyCurve",
  "averageBpm", "medianBpm", "bpmRange", "bpmClusters", "bpmCurve", "maximumTransitionGap",
  "preferredArtists", "preferredGenres", "releaseYearRange", "discoveryPreference", "familiarityPreference",
  "popularityRange", "deepCutPreference", "durationRange", "explicitPreference", "livePreference",
  "metadataConfidencePreference",
] as const;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const chunks = <T,>(items: T[], size = 250) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
const normalize = (value: string) => value.trim().toLowerCase();
const identityUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  learningEnabled: z.boolean().optional(),
  preservationMode: z.enum(PLAYLIST_IDENTITY_MODES).optional(),
  strength: z.coerce.number().min(0).max(1).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  userProfile: z.record(z.unknown()).optional(),
  lockedKeys: z.array(z.enum(profileKeys)).max(profileKeys.length).optional(),
  learningSettings: z.object({
    sensitivity: z.coerce.number().min(0).max(1).optional(),
    minimumEvidence: z.coerce.number().int().min(1).max(100).optional(),
    rejectionMemoryStrength: z.coerce.number().min(0).max(1).optional(),
    historicalDecay: z.coerce.number().min(0).max(1).optional(),
    manualAdditionsStrong: z.boolean().optional(),
    manualRemovalsNegative: z.boolean().optional(),
    restoredTracksPositive: z.boolean().optional(),
    playlistFeedbackEnabled: z.boolean().optional(),
  }).optional(),
});

function extractRevisionTracks(value: unknown) {
  if (Array.isArray(value)) return value;
  const record = value && typeof value === "object" ? value as any : null;
  return Array.isArray(record?.data?.tracks) ? record.data.tracks : [];
}

function identityTrack(track: any, position: number, weight: number): WeightedIdentityTrack {
  const moodTags = [...(track.tags || []), ...(track.artist?.tags || [])]
    .filter((tag: any) => String(tag.type).toLowerCase() === "mood").map((tag: any) => String(tag.name));
  const genres = [...(track.tags || []), ...(track.artist?.tags || [])]
    .filter((tag: any) => ["genre", "style", "subgenre"].includes(String(tag.type).toLowerCase())).map((tag: any) => String(tag.name));
  const confidences = [track.bpmConfidence, track.audioFeature?.audioFeatureConfidence, track.audioFeature?.confidence, track.popularity?.confidence]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return {
    id: track.id, artistId: track.artistId, artistName: track.artist?.title, moods: Array.from(new Set(moodTags)),
    genres: Array.from(new Set(genres)), bpm: track.effectiveBpm ?? track.bpm,
    energy: track.audioFeature?.effectiveEnergy ?? track.audioFeature?.energy,
    popularity: track.popularity?.score, durationMs: track.duration, year: track.album?.year,
    isLive: track.isLive, isExplicit: track.isExplicit,
    metadataConfidence: confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : null,
    position, weight,
  };
}

async function ownedPlaylist(userId: string, playlistId: string) {
  const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: playlistId, userId }, include: { tracks: { orderBy: { position: "asc" } } } });
  if (!playlist) throw new Error("Generated playlist not found");
  return playlist;
}

export async function ensurePlaylistIdentity(userId: string, playlistId: string, creationSource = "GENERATED") {
  const playlist = await ownedPlaylist(userId, playlistId);
  return prisma.playlistIdentity.upsert({
    where: { playlistId },
    create: {
      playlistId, userId, plexPlaylistId: playlist.plexPlaylistRatingKey, displayName: playlist.plexPlaylistTitle,
      creationSource, currentTrackCount: playlist.trackCount, lastRegeneratedAt: playlist.lastRegeneratedAt,
      learningSettingsJson: json({ sensitivity: 0.6, minimumEvidence: 5, rejectionMemoryStrength: 0.7, historicalDecay: 0.12, manualAdditionsStrong: true, manualRemovalsNegative: true, restoredTracksPositive: true, playlistFeedbackEnabled: true }),
    },
    update: {
      plexPlaylistId: playlist.plexPlaylistRatingKey, displayName: playlist.plexPlaylistTitle,
      currentTrackCount: playlist.trackCount, lastRegeneratedAt: playlist.lastRegeneratedAt,
    },
  });
}

async function loadTrainingTracks(userId: string, playlistId: string) {
  const playlist = await ownedPlaylist(userId, playlistId);
  const revisions = await prisma.playlistRevision.findMany({
    where: { generatedPlaylistId: playlistId }, select: { id: true, revisionNumber: true, trackSnapshot: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 50,
  });
  const currentIds = playlist.tracks.map((track) => track.trackId).filter((id): id is string => Boolean(id));
  const historicalRows = revisions.flatMap((revision) => extractRevisionTracks(revision.trackSnapshot).map((track: any) => ({
    trackId: typeof track.trackId === "string" ? track.trackId : null,
    position: Number(track.position) || 0,
    revisionId: revision.id,
    revisionNumber: revision.revisionNumber,
  }))).filter((track) => track.trackId);
  const allIds = Array.from(new Set([...currentIds, ...historicalRows.map((row) => row.trackId!)]));
  const libraryTracks: any[] = [];
  for (const batch of chunks(allIds)) {
    libraryTracks.push(...await prisma.track.findMany({
      where: { id: { in: batch }, library: { server: { userId } } },
      include: { artist: { include: { tags: true } }, album: true, tags: true, audioFeature: true, popularity: true },
    }));
  }
  const byId = new Map(libraryTracks.map((track) => [track.id, track]));
  const samples: WeightedIdentityTrack[] = [];
  playlist.tracks.forEach((row) => {
    const track = row.trackId ? byId.get(row.trackId) : null;
    if (track) samples.push(identityTrack(track, row.position, row.locked ? 4 : row.liked ? 3 : 2));
  });
  historicalRows.forEach((row, index) => {
    const track = byId.get(row.trackId!);
    if (track) samples.push(identityTrack(track, row.position, Math.max(0.25, 0.9 - index / Math.max(10, historicalRows.length) * 0.5)));
  });
  const feedback = await prisma.playlistFitFeedback.findMany({ where: { userId, playlistId }, select: { trackId: true, state: true, reason: true } });
  return { playlist, revisions, currentIds, historicalRows, libraryTracks, samples, feedback };
}

function attributeStates(learned: PlaylistIdentityProfile, user: Partial<PlaylistIdentityProfile>, lockedKeys: Set<string>, confidence: ReturnType<typeof confidenceForIdentity>) {
  return profileKeys.map<IdentityAttributeState>((key) => {
    const userValue = user[key];
    const learnedValue = learned[key];
    const locked = lockedKeys.has(key);
    const manual = userValue !== undefined && userValue !== null;
    const fieldConfidence = ["coreMoods", "secondaryMoods", "moodDistribution"].includes(key) ? confidence.mood
      : key.toLowerCase().includes("energy") ? confidence.energy : key.toLowerCase().includes("bpm") || key === "maximumTransitionGap" ? confidence.bpm
      : key === "preferredArtists" ? confidence.artist : key === "preferredGenres" ? confidence.genre
      : ["discoveryPreference", "familiarityPreference", "popularityRange", "deepCutPreference"].includes(key) ? confidence.discovery : confidence.overall;
    return {
      key, learnedValue, userValue, effectiveValue: manual ? userValue : learnedValue, locked, inherited: false,
      source: locked ? "LOCKED" : manual ? "MANUAL" : fieldConfidence < 0.18 ? "INSUFFICIENT_DATA" : "LEARNED",
      confidence: fieldConfidence, insufficientData: fieldConfidence < 0.18, evidenceCount: learned.sampleCount,
    };
  });
}

function compareProfiles(before: any, after: PlaylistIdentityProfile) {
  if (!before) return { changedKeys: profileKeys, summary: "Initial playlist identity training completed." };
  const changedKeys = profileKeys.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  return {
    changedKeys,
    summary: `${changedKeys.length} identity characteristic${changedKeys.length === 1 ? "" : "s"} changed.`,
    bpm: { before: before.bpmRange || null, after: after.bpmRange },
    energy: { before: before.energyRange || null, after: after.energyRange },
    moods: { before: before.coreMoods || [], after: after.coreMoods },
  };
}

export async function trainPlaylistIdentity(input: { userId: string; playlistId: string; source?: string }): Promise<any> {
  const identity = await ensurePlaylistIdentity(input.userId, input.playlistId, input.source || "GENERATED");
  const globalSettings = await prisma.syncSettings.findUnique({ where: { userId: input.userId }, select: { playlistIdentityLearningEnabled: true } });
  if (globalSettings?.playlistIdentityLearningEnabled === false && input.source !== "MANUAL_RETRAIN") return getPlaylistIdentity(input.userId, input.playlistId, false);
  if (!identity.learningEnabled && input.source !== "MANUAL_RETRAIN") return getPlaylistIdentity(input.userId, input.playlistId, false);
  const active = await prisma.playlistIdentityTrainingRun.findFirst({ where: { playlistIdentityId: identity.id, status: "RUNNING" }, select: { id: true } });
  if (active) throw new Error("Playlist identity training is already running.");
  const job = await safeStartJobHistory({ userId: input.userId, type: "playlist_identity", name: "Train playlist identity", trigger: input.source === "MANUAL_RETRAIN" ? "manual" : "automatic", metadata: { playlistId: input.playlistId } });
  const run = await prisma.playlistIdentityTrainingRun.create({
    data: { playlistIdentityId: identity.id, source: input.source || "CURRENT_AND_HISTORY", beforeProfileJson: identity.effectiveProfileJson || undefined, stagesJson: json(["Loading playlist history", "Analyzing track characteristics", "Calculating artist preferences", "Calculating genre preferences", "Building BPM profile", "Building mood and energy profile", "Processing rejection memory", "Saving identity snapshot"]) },
  });
  try {
    const data = await loadTrainingTracks(input.userId, input.playlistId);
    const learned = calculatePlaylistIdentityProfile(data.samples);
    const userProfile = (identity.userProfileJson || {}) as Partial<PlaylistIdentityProfile>;
    const existingAttributes = await prisma.playlistIdentityAttribute.findMany({ where: { playlistIdentityId: identity.id }, select: { key: true, locked: true } });
    const lockedKeys = new Set(existingAttributes.filter((attribute) => attribute.locked).map((attribute) => attribute.key));
    const effective = mergeIdentityProfiles(learned, userProfile, lockedKeys);
    const confidence = confidenceForIdentity(learned, { versions: data.revisions.length, explicitSignals: data.feedback.length });
    const attributes = attributeStates(learned, userProfile, lockedKeys, confidence);
    const artistPreferences = learned.preferredArtists.map((artist) => ({ artistId: artist.artistId, score: artist.score * 10, evidenceCount: Math.max(1, Math.round(artist.score * learned.sampleCount)), state: artist.score >= 0.12 ? "CORE" : artist.score >= 0.06 ? "STRONG" : "MODERATE" }));
    const genrePreferences = learned.preferredGenres.map((genre) => ({ genreKey: normalize(genre.name), displayName: genre.name, score: genre.score * 10, evidenceCount: Math.max(1, Math.round(genre.score * learned.sampleCount)), state: genre.score >= 0.18 ? "CORE" : genre.score >= 0.08 ? "STRONG" : "MODERATE" }));
    const historicalUnique = new Set(data.historicalRows.map((row) => row.trackId));
    const membershipStats = new Map<string, { count: number; current: boolean; position: number; locked: boolean; liked: boolean }>();
    for (const row of data.historicalRows) {
      const current = membershipStats.get(row.trackId!) || { count: 0, current: false, position: row.position, locked: false, liked: false };
      current.count += 1; membershipStats.set(row.trackId!, current);
    }
    for (const row of data.playlist.tracks.filter((item) => item.trackId)) {
      const current = membershipStats.get(row.trackId!) || { count: 0, current: false, position: row.position, locked: false, liked: false };
      current.count += 1; current.current = true; current.position = row.position; current.locked = row.locked; current.liked = row.liked; membershipStats.set(row.trackId!, current);
    }
    const comparison = compareProfiles(identity.effectiveProfileJson, effective);
    await prisma.$transaction(async (tx) => {
      await tx.playlistIdentity.update({
        where: { id: identity.id },
        data: {
          displayName: data.playlist.plexPlaylistTitle, plexPlaylistId: data.playlist.plexPlaylistRatingKey,
          learnedProfileJson: json(learned), effectiveProfileJson: json(effective), confidenceReasonsJson: json(confidence.reasons),
          confidence: confidence.overall, confidenceState: confidence.label, moodConfidence: confidence.mood,
          energyConfidence: confidence.energy, bpmConfidence: confidence.bpm, artistConfidence: confidence.artist,
          genreConfidence: confidence.genre, discoveryConfidence: confidence.discovery, avoidanceConfidence: confidence.avoidance,
          transitionConfidence: confidence.transition, trainingSampleCount: learned.sampleCount,
          historicalTrackCount: historicalUnique.size, currentTrackCount: data.currentIds.length, versionCount: data.revisions.length,
          lastTrainedAt: new Date(), lastRegeneratedAt: data.playlist.lastRegeneratedAt,
        },
      });
      for (const attribute of attributes) {
        await tx.playlistIdentityAttribute.upsert({
          where: { playlistIdentityId_key: { playlistIdentityId: identity.id, key: attribute.key } },
          create: { playlistIdentityId: identity.id, key: attribute.key, userValueJson: attribute.userValue == null ? undefined : json(attribute.userValue), learnedValueJson: json(attribute.learnedValue), effectiveValueJson: json(attribute.effectiveValue), locked: attribute.locked, source: attribute.source, confidence: attribute.confidence, insufficientData: attribute.insufficientData, evidenceCount: attribute.evidenceCount },
          update: { userValueJson: attribute.userValue == null ? Prisma.JsonNull : json(attribute.userValue), learnedValueJson: json(attribute.learnedValue), effectiveValueJson: json(attribute.effectiveValue), source: attribute.source, confidence: attribute.confidence, insufficientData: attribute.insufficientData, evidenceCount: attribute.evidenceCount },
        });
      }
      await tx.playlistArtistPreference.deleteMany({ where: { playlistIdentityId: identity.id, userDefined: false, locked: false } });
      if (artistPreferences.length) await tx.playlistArtistPreference.createMany({ data: artistPreferences.map((item) => ({ playlistIdentityId: identity.id, ...item })) });
      await tx.playlistGenrePreference.deleteMany({ where: { playlistIdentityId: identity.id, userDefined: false, locked: false } });
      if (genrePreferences.length) await tx.playlistGenrePreference.createMany({ data: genrePreferences.map((item) => ({ playlistIdentityId: identity.id, ...item })) });
      for (const batch of chunks(Array.from(membershipStats.entries()), 100)) {
        for (const [trackId, stats] of batch) {
          await tx.playlistTrackMemory.upsert({
            where: { playlistIdentityId_trackId: { playlistIdentityId: identity.id, trackId } },
            create: { playlistIdentityId: identity.id, trackId, importance: stats.locked ? "LOCKED" : stats.liked ? "PREFERRED" : "NORMAL", acceptanceScore: stats.locked ? 4 : stats.liked ? 2 : Math.min(3, stats.count * .35), membershipCount: stats.count, retainedCount: Math.max(0, stats.count - 1), firstSeenAt: new Date(), lastSeenAt: stats.current ? new Date() : undefined },
            update: { importance: stats.locked ? "LOCKED" : undefined, acceptanceScore: stats.locked ? 4 : stats.liked ? 2 : Math.min(3, stats.count * .35), membershipCount: stats.count, retainedCount: Math.max(0, stats.count - 1), lastSeenAt: stats.current ? new Date() : undefined },
          });
        }
      }
      for (const batch of chunks(data.historicalRows, 500)) {
        await tx.playlistMembershipEvent.createMany({
          data: batch.map((row) => ({ playlistIdentityId: identity.id, trackId: row.trackId!, eventType: "VERSION_MEMBERSHIP", eventSource: "PLAYLIST_VERSION", newPosition: row.position, playlistVersionId: row.revisionId, userId: input.userId, eventKey: `${identity.id}:version:${row.revisionId}:${row.trackId}:${row.position}` })),
          skipDuplicates: true,
        });
      }
      await tx.playlistMembershipEvent.createMany({
        data: data.playlist.tracks.filter((row) => row.trackId).map((row) => ({ playlistIdentityId: identity.id, trackId: row.trackId!, eventType: "CURRENT_MEMBERSHIP", eventSource: input.source || "TRAINING", newPosition: row.position, userId: input.userId, engineVersion: data.playlist.engineVersion, eventKey: `${identity.id}:current:${data.playlist.updatedAt.toISOString()}:${row.trackId}:${row.position}` })),
        skipDuplicates: true,
      });
      await tx.playlistIdentitySnapshot.create({ data: { playlistIdentityId: identity.id, reason: input.source || "TRAINING", profileJson: json(effective), confidenceJson: json(confidence), summaryJson: json(comparison) } });
      await tx.playlistIdentityTrainingRun.update({ where: { id: run.id }, data: { status: "COMPLETED", afterProfileJson: json(effective), comparisonJson: json(comparison), tracksAnalyzed: learned.sampleCount, eventsAnalyzed: data.feedback.length, versionsAnalyzed: data.revisions.length, completedAt: new Date() } });
    });
    await safeFinishJobHistory({ job, status: "completed", summary: `Playlist identity trained from ${learned.sampleCount} weighted track samples and ${data.revisions.length} versions.`, counts: { attempted: learned.sampleCount, processed: learned.sampleCount }, metadata: { playlistId: input.playlistId, confidence: confidence.label, changedKeys: comparison.changedKeys } });
    console.info("[PlaylistIdentity] Training complete", { playlistId: input.playlistId, tracks: learned.sampleCount, versions: data.revisions.length, confidence: confidence.label });
    return getPlaylistIdentity(input.userId, input.playlistId, false);
  } catch (error) {
    await prisma.playlistIdentityTrainingRun.update({ where: { id: run.id }, data: { status: "FAILED", error: error instanceof Error ? error.message : "Training failed", completedAt: new Date() } }).catch(() => undefined);
    await safeFinishJobHistory({ job, status: "failed", error, summary: "Playlist identity training failed; normal playlist use remains available." });
    throw error;
  }
}

function personalitySummary(identity: any) {
  const profile = (identity.effectiveProfileJson || {}) as Partial<PlaylistIdentityProfile>;
  const bpm = profile.bpmRange ? `${Math.round(profile.bpmRange[0])}-${Math.round(profile.bpmRange[1])} BPM` : "Not enough BPM data";
  const energy = profile.energyCurve?.type ? `${profile.energyCurve.type[0].toUpperCase()}${profile.energyCurve.type.slice(1)} energy curve` : "Not enough energy data";
  return {
    title: identity.displayName,
    coreMood: profile.coreMoods?.length ? profile.coreMoods.join(", ") : "Still learning",
    preferredBpm: bpm,
    energy,
    discovery: profile.discoveryPreference == null ? "Still learning" : profile.discoveryPreference >= 0.7 ? "High" : profile.discoveryPreference >= 0.45 ? "Medium-high" : profile.discoveryPreference >= 0.25 ? "Balanced" : "Familiar",
    preferred: [...(profile.preferredGenres || []).slice(0, 5).map((item) => item.name), ...(profile.preferredArtists || []).slice(0, 3).map((item) => item.name)],
    avoid: [
      ...(profile.livePreference === "avoid" ? ["Live recordings"] : []),
      ...(profile.explicitPreference === "avoid" ? ["Explicit tracks"] : []),
      ...(profile.maximumTransitionGap ? [`BPM jumps over ${Math.round(profile.maximumTransitionGap)}`] : []),
    ],
    confidence: identity.confidenceState,
    explanation: `Based on ${identity.historicalTrackCount || identity.currentTrackCount} historical tracks and ${identity.versionCount} playlist versions.`,
  };
}

export async function getPlaylistIdentity(userId: string, playlistId: string, initialize = true): Promise<any> {
  let identity = await prisma.playlistIdentity.findFirst({
    where: { playlistId, userId },
    include: {
      attributes: { orderBy: { key: "asc" } },
      artistPreferences: { include: { artist: { select: { title: true } } }, orderBy: { score: "desc" }, take: 25 },
      genrePreferences: { orderBy: { score: "desc" }, take: 25 },
      trackMemories: { where: { OR: [{ importance: { not: "NORMAL" } }, { rejectionState: { not: "NONE" } }] }, include: { track: { select: { id: true, title: true, artist: { select: { title: true } } } } }, orderBy: { updatedAt: "desc" }, take: 100 },
      trainingRuns: { orderBy: { startedAt: "desc" }, take: 10 },
      snapshots: { orderBy: { createdAt: "desc" }, take: 10 },
      _count: { select: { trackMemories: true, membershipEvents: true } },
    },
  });
  if (!identity && initialize) {
    identity = await ensurePlaylistIdentity(userId, playlistId, "LAZY_LEGACY") as any;
    return trainPlaylistIdentity({ userId, playlistId, source: "LAZY_LEGACY" });
  }
  if (!identity) return null;
  return { identity, summary: personalitySummary(identity), privacy: "Playlist identity, membership history, rejection memory, preferences, and training snapshots are stored only in your local Mixarr PostgreSQL database and are not sent to external services." };
}

export async function updatePlaylistIdentity(userId: string, playlistId: string, raw: unknown) {
  const input = identityUpdateSchema.parse(raw);
  const identity = await ensurePlaylistIdentity(userId, playlistId, "MANUAL_ENABLE");
  const currentUserProfile = (identity.userProfileJson || {}) as Record<string, unknown>;
  const nextUserProfile = { ...currentUserProfile, ...(input.userProfile || {}) };
  await prisma.$transaction(async (tx) => {
    await tx.playlistIdentity.update({
      where: { id: identity.id },
      data: {
        enabled: input.enabled, learningEnabled: input.learningEnabled, preservationMode: input.preservationMode,
        strength: input.strength, description: input.description, userProfileJson: input.userProfile ? json(nextUserProfile) : undefined,
        learningSettingsJson: input.learningSettings ? json({ ...((identity.learningSettingsJson || {}) as any), ...input.learningSettings }) : undefined,
      },
    });
    if (input.lockedKeys) {
      await tx.playlistIdentityAttribute.updateMany({ where: { playlistIdentityId: identity.id }, data: { locked: false } });
      if (input.lockedKeys.length) await tx.playlistIdentityAttribute.updateMany({ where: { playlistIdentityId: identity.id, key: { in: input.lockedKeys } }, data: { locked: true, source: "LOCKED" } });
    }
  });
  if (input.userProfile || input.lockedKeys) return trainPlaylistIdentity({ userId, playlistId, source: "MANUAL_RETRAIN" });
  return getPlaylistIdentity(userId, playlistId, false);
}

export async function loadPlaylistIdentityScoringContext(userId: string, playlistId?: string | null): Promise<PlaylistIdentityScoringContext | undefined> {
  if (!playlistId) return undefined;
  try {
    const identity = await prisma.playlistIdentity.findFirst({
      where: { playlistId, userId, enabled: true },
      include: {
        artistPreferences: { select: { artistId: true, score: true } },
        genrePreferences: { select: { genreKey: true, score: true } },
        trackMemories: { where: { OR: [{ rejectionState: { not: "NONE" } }, { importance: { not: "NORMAL" } }, { acceptanceScore: { not: 0 } }] }, select: { trackId: true, importance: true, rejectionState: true, permanentRejection: true, acceptanceScore: true, rejectionCount: true } },
      },
    });
    if (!identity?.effectiveProfileJson) return undefined;
    return {
      identityId: identity.id, enabled: identity.enabled, mode: identity.preservationMode as PlaylistIdentityMode,
      strength: identity.strength, profile: identity.effectiveProfileJson as unknown as PlaylistIdentityProfile,
      artistScores: Object.fromEntries(identity.artistPreferences.map((item) => [item.artistId, item.score])),
      genreScores: Object.fromEntries(identity.genrePreferences.map((item) => [item.genreKey, item.score])),
      trackMemory: Object.fromEntries(identity.trackMemories.map((item) => [item.trackId, item])),
    };
  } catch (error) {
    console.warn("[PlaylistIdentity] identity loading failed; regeneration will use existing scoring", { playlistId, message: error instanceof Error ? error.message : "unknown error" });
    return undefined;
  }
}

export async function recordPlaylistIdentityEvent(input: {
  userId: string; playlistId: string; trackId?: string | null; eventType: string; eventSource: string; eventKey: string;
  previousPosition?: number | null; newPosition?: number | null; playlistVersionId?: string | null; generationRunId?: string | null;
  engineVersion?: string | null; feedbackReason?: string | null; snapshot?: unknown;
}) {
  const identity = await ensurePlaylistIdentity(input.userId, input.playlistId);
  await prisma.playlistMembershipEvent.create({
    data: {
      playlistIdentityId: identity.id, trackId: input.trackId || null, eventType: input.eventType, eventSource: input.eventSource,
      eventKey: `${identity.id}:${input.eventKey}`, previousPosition: input.previousPosition, newPosition: input.newPosition,
      playlistVersionId: input.playlistVersionId, generationRunId: input.generationRunId, engineVersion: input.engineVersion,
      userId: input.userId, feedbackReason: input.feedbackReason, snapshotJson: input.snapshot ? json(input.snapshot) : undefined,
    },
  }).catch((error) => {
    if (String(error?.code) !== "P2002") throw error;
  });
  return identity;
}

export async function rememberPlaylistRejection(input: { userId: string; playlistId: string; trackId: string; reason?: string | null; source: string; permanent?: boolean; strong?: boolean; eventKey: string }) {
  const identity = await recordPlaylistIdentityEvent({ ...input, eventType: input.permanent ? "TRACK_NEVER_USE" : "TRACK_REJECTED", eventSource: input.source, eventKey: input.eventKey, feedbackReason: input.reason });
  const now = new Date();
  await prisma.playlistTrackMemory.upsert({
    where: { playlistIdentityId_trackId: { playlistIdentityId: identity.id, trackId: input.trackId } },
    create: { playlistIdentityId: identity.id, trackId: input.trackId, rejectionState: input.permanent ? "NEVER_USE" : input.strong ? "STRONG_NEGATIVE" : "WEAK_NEGATIVE", rejectionReason: input.reason, rejectionSource: input.source, rejectionCount: 1, firstRejectedAt: now, lastRejectedAt: now, permanentRejection: Boolean(input.permanent), userConfirmedRejection: input.source !== "AUTOMATIC", inferenceConfidence: input.permanent ? 1 : input.strong ? 0.8 : 0.35 },
    update: { rejectionState: input.permanent ? "NEVER_USE" : input.strong ? "STRONG_NEGATIVE" : "WEAK_NEGATIVE", rejectionReason: input.reason, rejectionSource: input.source, rejectionCount: { increment: 1 }, lastRejectedAt: now, permanentRejection: Boolean(input.permanent), userConfirmedRejection: input.source !== "AUTOMATIC", inferenceConfidence: input.permanent ? 1 : input.strong ? 0.8 : 0.35 },
  });
}

export async function updatePlaylistTrackMemory(userId: string, playlistId: string, trackId: string, raw: unknown) {
  const input = z.object({
    importance: z.enum(["NORMAL", "PREFERRED", "IMPORTANT", "ANCHOR", "LOCKED"]).optional(),
    section: z.enum(["INTRO", "MIDDLE", "ENDING"]).nullable().optional(),
    positionLocked: z.boolean().optional(),
    rejectionState: z.enum(["NONE", "TEMPORARY", "WEAK_NEGATIVE", "STRONG_NEGATIVE", "NEVER_USE"]).optional(),
    rejectionReason: z.string().trim().max(120).nullable().optional(),
  }).parse(raw);
  const playlist = await ownedPlaylist(userId, playlistId);
  if (!playlist.tracks.some((row) => row.trackId === trackId) && !(await prisma.track.findFirst({ where: { id: trackId, library: { server: { userId } } }, select: { id: true } }))) throw new Error("Track not found");
  const identity = await ensurePlaylistIdentity(userId, playlistId);
  const memory = await prisma.playlistTrackMemory.upsert({
    where: { playlistIdentityId_trackId: { playlistIdentityId: identity.id, trackId } },
    create: { playlistIdentityId: identity.id, trackId, importance: input.importance || "NORMAL", section: input.section, positionLocked: input.positionLocked || false, rejectionState: input.rejectionState || "NONE", rejectionReason: input.rejectionReason, permanentRejection: input.rejectionState === "NEVER_USE", userConfirmedRejection: Boolean(input.rejectionState && input.rejectionState !== "NONE") },
    update: { importance: input.importance, section: input.section, positionLocked: input.positionLocked, rejectionState: input.rejectionState, rejectionReason: input.rejectionReason, permanentRejection: input.rejectionState === "NEVER_USE" ? true : input.rejectionState === "NONE" ? false : undefined, userConfirmedRejection: input.rejectionState ? input.rejectionState !== "NONE" : undefined },
  });
  await recordPlaylistIdentityEvent({ userId, playlistId, trackId, eventType: input.importance ? "IMPORTANCE_CHANGED" : "REJECTION_CHANGED", eventSource: "IDENTITY_EDITOR", eventKey: `memory:${memory.id}:${memory.updatedAt.toISOString()}`, snapshot: input });
  return memory;
}

export async function resetPlaylistIdentity(userId: string, playlistId: string, scope: string) {
  const identity = await prisma.playlistIdentity.findFirst({ where: { playlistId, userId } });
  if (!identity) return { reset: false };
  await prisma.$transaction(async (tx) => {
    if (scope === "DISABLE") await tx.playlistIdentity.update({ where: { id: identity.id }, data: { enabled: false } });
    else if (scope === "DELETE") await tx.playlistIdentity.delete({ where: { id: identity.id } });
    else if (scope === "REJECTIONS") await tx.playlistTrackMemory.updateMany({ where: { playlistIdentityId: identity.id }, data: { rejectionState: "NONE", rejectionReason: null, rejectionCount: 0, permanentRejection: false, userConfirmedRejection: false } });
    else if (scope === "HISTORY") await tx.playlistMembershipEvent.deleteMany({ where: { playlistIdentityId: identity.id } });
    else if (scope === "MANUAL") {
      await tx.playlistIdentity.update({ where: { id: identity.id }, data: { userProfileJson: Prisma.JsonNull } });
      await tx.playlistIdentityAttribute.updateMany({ where: { playlistIdentityId: identity.id }, data: { userValueJson: Prisma.JsonNull, locked: false, inherited: false } });
    } else {
      await tx.playlistIdentity.update({ where: { id: identity.id }, data: { learnedProfileJson: Prisma.JsonNull, effectiveProfileJson: identity.userProfileJson || Prisma.JsonNull, confidence: 0, confidenceState: "INSUFFICIENT_DATA", lastTrainedAt: null, trainingSampleCount: 0 } });
      await tx.playlistIdentityAttribute.updateMany({ where: { playlistIdentityId: identity.id }, data: { learnedValueJson: Prisma.JsonNull, confidence: 0, insufficientData: true } });
      await tx.playlistArtistPreference.deleteMany({ where: { playlistIdentityId: identity.id, userDefined: false } });
      await tx.playlistGenrePreference.deleteMany({ where: { playlistIdentityId: identity.id, userDefined: false } });
    }
  });
  await safeRecordJobHistory({ userId, type: "playlist_identity", name: "Reset playlist identity", status: "completed", trigger: "manual", summary: `Playlist identity reset scope: ${scope}. Playlist tracks were not deleted.`, counts: { attempted: 1, processed: 1 }, metadata: { playlistId, scope } });
  return { reset: true, scope };
}

export async function clonePlaylistIdentity(input: { userId: string; playlistId: string; name: string; includeImportantTracks?: boolean; includeLockedTracks?: boolean; includeRejections?: boolean }) {
  const source = await prisma.playlistIdentity.findFirst({ where: { playlistId: input.playlistId, userId: input.userId }, include: { attributes: true, trackMemories: true, artistPreferences: true, genrePreferences: true, playlist: true } });
  if (!source) throw new Error("Playlist identity not found");
  const selectedMemory = source.trackMemories.filter((memory) => (input.includeLockedTracks && memory.importance === "LOCKED") || (input.includeImportantTracks && ["PREFERRED", "IMPORTANT", "ANCHOR"].includes(memory.importance)) || (input.includeRejections && memory.rejectionState !== "NONE"));
  const selectedIds = selectedMemory.filter((memory) => memory.importance !== "NORMAL").map((memory) => memory.trackId);
  const tracks = selectedIds.length ? await prisma.track.findMany({ where: { id: { in: selectedIds }, library: { server: { userId: input.userId } } }, include: { artist: true, album: true } }) : [];
  const target = await prisma.$transaction(async (tx) => {
    const playlist = await tx.generatedPlaylist.create({ data: { userId: input.userId, serverId: source.playlist.serverId, plexPlaylistTitle: input.name, sourceType: "identity_clone", engineVersion: source.playlist.engineVersion, filtersJson: json(source.playlist.filtersJson), safetyRulesJson: source.playlist.safetyRulesJson == null ? undefined : json(source.playlist.safetyRulesJson), tuningConfigJson: source.playlist.tuningConfigJson == null ? undefined : json(source.playlist.tuningConfigJson), scoringModel: source.playlist.scoringModel, scoringModelVersion: source.playlist.scoringModelVersion, trackCount: tracks.length } });
    if (tracks.length) await tx.generatedPlaylistTrack.createMany({ data: selectedIds.flatMap((trackId, index) => {
      const track = tracks.find((item) => item.id === trackId);
      const memory = selectedMemory.find((item) => item.trackId === trackId);
      return track ? [{ generatedPlaylistId: playlist.id, trackId, plexTrackRatingKey: track.ratingKey || track.plexId, position: index + 1, title: track.title, artist: track.artist?.title, album: track.album?.title, locked: memory?.importance === "LOCKED" }] : [];
    }) });
    const identity = await tx.playlistIdentity.create({ data: { playlistId: playlist.id, userId: input.userId, displayName: input.name, description: source.description, enabled: source.enabled, learningEnabled: source.learningEnabled, preservationMode: source.preservationMode, strength: source.strength, confidence: source.confidence, confidenceState: source.confidenceState, creationSource: "CLONED", schemaVersion: source.schemaVersion, trainingSampleCount: source.trainingSampleCount, historicalTrackCount: 0, currentTrackCount: tracks.length, learnedProfileJson: source.learnedProfileJson == null ? undefined : json(source.learnedProfileJson), userProfileJson: source.userProfileJson == null ? undefined : json(source.userProfileJson), effectiveProfileJson: source.effectiveProfileJson == null ? undefined : json(source.effectiveProfileJson), confidenceReasonsJson: source.confidenceReasonsJson == null ? undefined : json(source.confidenceReasonsJson), learningSettingsJson: source.learningSettingsJson == null ? undefined : json(source.learningSettingsJson) } });
    if (source.attributes.length) await tx.playlistIdentityAttribute.createMany({ data: source.attributes.map((attribute) => ({ playlistIdentityId: identity.id, key: attribute.key, userValueJson: attribute.userValueJson || undefined, learnedValueJson: attribute.learnedValueJson || undefined, effectiveValueJson: attribute.effectiveValueJson || undefined, locked: attribute.locked, inherited: true, source: "INHERITED", confidence: attribute.confidence, insufficientData: attribute.insufficientData, evidenceCount: attribute.evidenceCount })) });
    if (source.artistPreferences.length) await tx.playlistArtistPreference.createMany({ data: source.artistPreferences.map((preference) => ({ playlistIdentityId: identity.id, artistId: preference.artistId, score: preference.score, state: preference.state, evidenceCount: preference.evidenceCount, positiveEvidence: preference.positiveEvidence, negativeEvidence: preference.negativeEvidence, userDefined: preference.userDefined, locked: preference.locked })) });
    if (source.genrePreferences.length) await tx.playlistGenrePreference.createMany({ data: source.genrePreferences.map((preference) => ({ playlistIdentityId: identity.id, genreKey: preference.genreKey, displayName: preference.displayName, genreType: preference.genreType, score: preference.score, state: preference.state, evidenceCount: preference.evidenceCount, positiveEvidence: preference.positiveEvidence, negativeEvidence: preference.negativeEvidence, userDefined: preference.userDefined, locked: preference.locked })) });
    if (selectedMemory.length) await tx.playlistTrackMemory.createMany({ data: selectedMemory.map((memory) => ({ playlistIdentityId: identity.id, trackId: memory.trackId, importance: memory.importance, section: memory.section, positionLocked: memory.positionLocked, rejectionState: input.includeRejections ? memory.rejectionState : "NONE", rejectionReason: input.includeRejections ? memory.rejectionReason : null, rejectionSource: "CLONED", rejectionCount: input.includeRejections ? memory.rejectionCount : 0, permanentRejection: input.includeRejections && memory.permanentRejection, userConfirmedRejection: input.includeRejections && memory.userConfirmedRejection, inferenceConfidence: memory.inferenceConfidence, acceptanceScore: memory.acceptanceScore })) });
    return { playlist, identity };
  });
  await safeRecordJobHistory({ userId: input.userId, type: "playlist_identity", name: "Clone playlist identity", status: "completed", trigger: "manual", summary: `Cloned "${source.displayName}" into "${input.name}" with a new independent identity.`, counts: { attempted: 1, processed: 1 }, metadata: { sourceIdentityId: source.id, targetIdentityId: target.identity.id, targetPlaylistId: target.playlist.id } });
  console.info("[PlaylistIdentity] Identity cloned", { sourceId: source.id, targetId: target.identity.id });
  return target;
}
