import { Prisma, type PrismaClient } from "@prisma/client";
import prisma from "./prisma";

export const DEFAULT_DUPLICATE_DURATION_TOLERANCE_MS = Math.max(250, Number(process.env.DUPLICATE_DURATION_TOLERANCE_MS) || 2_000);

export type DuplicateConfidence = "high" | "medium" | "low";

export type DuplicateComparableTrack = {
  id?: string;
  ratingKey?: string | null;
  plexGuid?: string | null;
  mediaPath?: string | null;
  title?: string | null;
  duration?: number | null;
  artistTitle?: string | null;
  albumTitle?: string | null;
  artist?: { title?: string | null } | null;
  album?: { title?: string | null } | null;
  canonicalRecordingId?: string | null;
};

export type DuplicateAssessment = {
  confidence: DuplicateConfidence;
  score: number;
  shouldAutoGroup: boolean;
  needsReview: boolean;
  evidence: { signals: string[]; durationDifferenceMs: number | null; durationToleranceMs: number };
};

export function plexTrackInstanceIdentity(plexServerId: string, plexLibraryId: string, plexRatingKey: string) {
  return `${plexServerId}\u0000${plexLibraryId}\u0000${plexRatingKey}`;
}

export function duplicatePersistenceDisposition(assessment: DuplicateAssessment | null) {
  return {
    persistAsSeparateTrack: true,
    autoGroup: assessment?.shouldAutoGroup === true,
    reviewStatus: assessment?.needsReview ? "needs_review" as const : assessment ? "confirmed" as const : "not_duplicate" as const,
  };
}

export function countMissingPlexInstances(plexRatingKeys: string[], storedRatingKeys: Iterable<string>) {
  const stored = new Set(storedRatingKeys);
  return Array.from(new Set(plexRatingKeys)).filter((ratingKey) => !stored.has(ratingKey)).length;
}

export type DuplicateCandidateIndex<T extends DuplicateComparableTrack = DuplicateComparableTrack> = Map<string, T[]>;

export function normalizeRecordingText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*(remaster|remastered|live|explicit|mono|stereo|deluxe|version)[^)]*\)/gi, "")
    .replace(/\[[^\]]*(remaster|remastered|live|explicit|mono|stereo|deluxe|version)[^\]]*\]/gi, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function recordingFingerprint(artist: unknown, title: unknown) {
  const normalizedArtist = normalizeRecordingText(artist);
  const normalizedTitle = normalizeRecordingText(title);
  return normalizedArtist && normalizedTitle ? `${normalizedArtist}\u001f${normalizedTitle}` : null;
}

function artistTitle(track: DuplicateComparableTrack) {
  return track.artistTitle ?? track.artist?.title ?? "";
}

function albumTitle(track: DuplicateComparableTrack) {
  return track.albumTitle ?? track.album?.title ?? "";
}

function duplicateLookupKeys(track: DuplicateComparableTrack) {
  const keys: string[] = [];
  if (track.mediaPath) keys.push(`path:${track.mediaPath}`);
  if (track.plexGuid) keys.push(`guid:${track.plexGuid}`);
  const artist = normalizeRecordingText(artistTitle(track));
  const title = normalizeRecordingText(track.title);
  if (artist && title) keys.push(`recording:${artist}|${title}`);
  return keys;
}

export function addDuplicateCandidate<T extends DuplicateComparableTrack>(index: DuplicateCandidateIndex<T>, track: T) {
  for (const key of duplicateLookupKeys(track)) {
    const rows = index.get(key) || [];
    rows.push(track);
    index.set(key, rows);
  }
}

export function createDuplicateCandidateIndex<T extends DuplicateComparableTrack>(tracks: T[]) {
  const index: DuplicateCandidateIndex<T> = new Map();
  for (const track of tracks) addDuplicateCandidate(index, track);
  return index;
}

export function assessDuplicateRelationship(
  left: DuplicateComparableTrack,
  right: DuplicateComparableTrack,
  durationToleranceMs = DEFAULT_DUPLICATE_DURATION_TOLERANCE_MS,
): DuplicateAssessment {
  const signals: string[] = [];
  const leftDuration = typeof left.duration === "number" ? left.duration : null;
  const rightDuration = typeof right.duration === "number" ? right.duration : null;
  const durationDifferenceMs = leftDuration !== null && rightDuration !== null ? Math.abs(leftDuration - rightDuration) : null;
  const durationClose = durationDifferenceMs === null || durationDifferenceMs <= durationToleranceMs;
  const sameArtist = Boolean(normalizeRecordingText(artistTitle(left))) && normalizeRecordingText(artistTitle(left)) === normalizeRecordingText(artistTitle(right));
  const sameTitle = Boolean(normalizeRecordingText(left.title)) && normalizeRecordingText(left.title) === normalizeRecordingText(right.title);
  const sameAlbum = Boolean(normalizeRecordingText(albumTitle(left))) && normalizeRecordingText(albumTitle(left)) === normalizeRecordingText(albumTitle(right));
  const sameGuid = Boolean(left.plexGuid) && left.plexGuid === right.plexGuid;
  const samePath = Boolean(left.mediaPath) && left.mediaPath === right.mediaPath;

  if (samePath) signals.push("same_file_path");
  if (sameGuid) signals.push("plex_recording_guid");
  if (sameArtist) signals.push("normalized_artist");
  if (sameTitle) signals.push("normalized_title");
  if (sameAlbum) signals.push("normalized_album");
  if (durationClose && durationDifferenceMs !== null) signals.push("duration_within_tolerance");

  const high = samePath || (sameGuid && sameArtist && sameTitle && durationClose) || (sameArtist && sameTitle && sameAlbum && durationClose);
  const medium = !high && sameArtist && sameTitle && durationClose;
  const confidence: DuplicateConfidence = high ? "high" : medium ? "medium" : "low";
  const score = high ? (samePath ? 100 : sameGuid ? 96 : 90) : medium ? 65 : sameGuid ? 35 : 10;
  return {
    confidence,
    score,
    shouldAutoGroup: high,
    needsReview: !high,
    evidence: { signals, durationDifferenceMs, durationToleranceMs },
  };
}

export function findBestDuplicateCandidate<T extends DuplicateComparableTrack>(track: DuplicateComparableTrack, candidates: T[]) {
  return candidates
    .filter((candidate) => candidate.id !== track.id && candidate.ratingKey !== track.ratingKey)
    .map((candidate) => ({ candidate, assessment: assessDuplicateRelationship(track, candidate) }))
    .filter((entry) => entry.assessment.score >= 35)
    .sort((left, right) => right.assessment.score - left.assessment.score || String(left.candidate.id).localeCompare(String(right.candidate.id)))[0] || null;
}

export function findBestDuplicateCandidateFromIndex<T extends DuplicateComparableTrack>(track: DuplicateComparableTrack, index: DuplicateCandidateIndex<T>) {
  const candidates = new Map<string, T>();
  for (const key of duplicateLookupKeys(track)) {
    for (const candidate of index.get(key) || []) {
      candidates.set(String(candidate.id || candidate.ratingKey), candidate);
    }
  }
  return findBestDuplicateCandidate(track, Array.from(candidates.values()));
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function numberValue(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function correctionValue(track: any, field: string) {
  const correction = track.metadataCorrections?.find((item: any) => item.field === field && item.isActive && item.isVerified);
  if (!correction) return null;
  if (field === "mood" && Array.isArray(correction.valueJson)) return correction.valueJson;
  return numberValue(correction.valueJson);
}

function sourceRank(track: any) {
  if (track.metadataCorrections?.some((item: any) => item.isActive && item.isVerified)) return 500;
  if (track.localBpm != null || track.audioFeature?.localEnergy != null || track.audioFeature?.localMood != null) return 400;
  if (track.apiBpm != null || track.audioFeature?.apiEnergy != null || track.audioFeature?.apiMood != null) return 300 + Math.round(100 * Math.max(track.bpmConfidence || 0, track.audioFeature?.audioFeatureConfidence || 0));
  if (track.enrichmentProvenance) return 200;
  return 100;
}

export function enrichmentFromTrack(track: any) {
  const manualBpm = correctionValue(track, "bpm");
  const manualEnergy = correctionValue(track, "energy");
  const manualMood = correctionValue(track, "mood");
  const bpm = manualBpm ?? track.localBpm ?? track.apiBpm ?? track.effectiveBpm ?? track.bpm ?? track.audioFeature?.tempo ?? null;
  const energy = manualEnergy ?? track.audioFeature?.localEnergy ?? track.audioFeature?.apiEnergy ?? track.audioFeature?.effectiveEnergy ?? track.audioFeature?.energy ?? null;
  const mood = manualMood ?? track.audioFeature?.localMood ?? track.audioFeature?.apiMood ?? track.audioFeature?.effectiveMood ?? track.audioFeature?.valence ?? null;
  const manual = manualBpm !== null || manualEnergy !== null || manualMood !== null;
  const local = track.localBpm != null || track.audioFeature?.localEnergy != null || track.audioFeature?.localMood != null;
  const provider = manual ? "Manual verified correction" : local ? "Local Essentia" : track.bpmSource || track.audioFeature?.audioFeatureSource || track.audioFeature?.source || "Existing enrichment";
  return { bpm, energy, mood, provider, confidence: Math.max(track.bpmConfidence || 0, track.audioFeature?.audioFeatureConfidence || 0, track.audioFeature?.confidence || 0), rank: sourceRank(track) };
}

export function selectDuplicateEnrichmentSource<T extends { id: string }>(tracks: T[]) {
  const source = [...tracks].sort((left: any, right: any) => sourceRank(right) - sourceRank(left) || left.id.localeCompare(right.id))[0] || null;
  return source ? { source, enrichment: enrichmentFromTrack(source) } : null;
}

export function shouldInheritDuplicateField(member: any, field: "bpm" | "energy" | "mood") {
  if (member.metadataCorrections?.some((item: any) => item.field === field && item.isActive)) return false;
  if (field === "bpm") return member.localBpm == null && member.apiBpm == null;
  if (field === "energy") return member.audioFeature?.localEnergy == null && member.audioFeature?.apiEnergy == null;
  return member.audioFeature?.localMood == null && member.audioFeature?.apiMood == null;
}

function fieldCandidate(track: any, field: "bpm" | "energy" | "mood", preferred: boolean) {
  const manual = correctionValue(track, field);
  const confidence = Math.max(track.bpmConfidence || 0, track.audioFeature?.audioFeatureConfidence || 0, track.audioFeature?.confidence || 0);
  if (manual !== null) return { value: manual, rank: 500, provider: "Manual verified correction", confidence };
  if (field === "bpm" && track.localBpm != null) return { value: track.localBpm, rank: 400, provider: "Local Essentia", confidence };
  if (field === "energy" && track.audioFeature?.localEnergy != null) return { value: track.audioFeature.localEnergy, rank: 400, provider: "Local Essentia", confidence };
  if (field === "mood" && track.audioFeature?.localMood != null) return { value: track.audioFeature.localMood, rank: 400, provider: "Local Essentia", confidence };
  if (field === "bpm" && track.apiBpm != null) return { value: track.apiBpm, rank: 300 + confidence, provider: track.bpmSource || "API analysis", confidence };
  if (field === "energy" && track.audioFeature?.apiEnergy != null) return { value: track.audioFeature.apiEnergy, rank: 300 + confidence, provider: track.audioFeature.audioFeatureSource || "API analysis", confidence };
  if (field === "mood" && track.audioFeature?.apiMood != null) return { value: track.audioFeature.apiMood, rank: 300 + confidence, provider: track.audioFeature.audioFeatureSource || "API analysis", confidence };
  const fallback = field === "bpm"
    ? track.effectiveBpm ?? track.bpm ?? track.audioFeature?.tempo
    : field === "energy"
      ? track.audioFeature?.effectiveEnergy ?? track.audioFeature?.energy
      : track.audioFeature?.effectiveMood ?? track.audioFeature?.valence ?? track.tags?.filter((tag: any) => tag.type === "mood").map((tag: any) => tag.name);
  if (fallback !== null && fallback !== undefined && (!Array.isArray(fallback) || fallback.length)) {
    const inherited = Boolean(track.enrichmentProvenance && (track.enrichmentProvenance as any)[field]);
    return { value: fallback, rank: (inherited ? 200 : 100) + (preferred ? 25 : 0), provider: inherited ? "Duplicate group" : "Existing enrichment", confidence };
  }
  return null;
}

function selectFieldSource(tracks: any[], field: "bpm" | "energy" | "mood", preferredTrackId?: string | null) {
  return tracks.map((track) => ({ track, candidate: fieldCandidate(track, field, track.id === preferredTrackId) }))
    .filter((entry) => entry.candidate !== null)
    .sort((left, right) => right.candidate!.rank - left.candidate!.rank || left.track.id.localeCompare(right.track.id))[0] || null;
}

export async function refreshCanonicalEnrichment(groupId: string, preferredTrackId?: string | null, db: any = prisma) {
  const group = await db.canonicalRecording.findUnique({
    where: { id: groupId },
    include: {
      tracks: {
        where: { syncStatus: "active" },
        include: { audioFeature: true, metadataCorrections: { where: { isActive: true } }, tags: { where: { type: "mood" } } },
      },
    },
  });
  if (!group || !group.inheritanceEnabled || !group.tracks.length) return { inherited: 0, sourceTrackId: null };
  const effectivePreferredId = preferredTrackId || group.preferredEnrichmentTrackId;
  const preferred = group.tracks.find((track: any) => track.id === effectivePreferredId);
  const source = preferred || selectDuplicateEnrichmentSource(group.tracks)!.source;
  const fieldSources = {
    bpm: selectFieldSource(group.tracks, "bpm", effectivePreferredId),
    energy: selectFieldSource(group.tracks, "energy", effectivePreferredId),
    mood: selectFieldSource(group.tracks, "mood", effectivePreferredId),
  };
  const shared = { bpm: fieldSources.bpm?.candidate?.value ?? null, energy: fieldSources.energy?.candidate?.value ?? null, mood: fieldSources.mood?.candidate?.value ?? null };
  const fieldProvenance = Object.fromEntries(Object.entries(fieldSources).map(([field, entry]) => [field, entry ? {
    valueSource: "Duplicate group",
    inheritedFromTrackId: entry.track.id,
    originalProvider: entry.candidate!.provider,
    confidence: entry.candidate!.confidence,
    updatedAt: new Date().toISOString(),
  } : null]));

  await db.canonicalRecording.update({
    where: { id: group.id },
    data: {
      preferredEnrichmentTrackId: source.id,
      sharedEnrichment: json({ bpm: shared.bpm, energy: shared.energy, mood: shared.mood }),
      enrichmentProvenance: json(fieldProvenance),
    },
  });

  let inherited = 0;
  for (const member of group.tracks) {
    if (!member.inheritDuplicateEnrichment) continue;
    const existingProvenance = member.enrichmentProvenance && typeof member.enrichmentProvenance === "object" && !Array.isArray(member.enrichmentProvenance)
      ? member.enrichmentProvenance as Record<string, any>
      : {};
    const nextProvenance = { ...existingProvenance };
    let changed = false;

    if (member.id !== fieldSources.bpm?.track.id && shouldInheritDuplicateField(member, "bpm") && shared.bpm != null) {
      await db.track.update({ where: { id: member.id }, data: { effectiveBpm: numberValue(shared.bpm), bpmSource: "duplicate_group" } });
      nextProvenance.bpm = fieldProvenance.bpm;
      changed = true;
    }
    const audioData: Record<string, any> = {};
    if (member.id !== fieldSources.energy?.track.id && shouldInheritDuplicateField(member, "energy") && shared.energy != null) {
      audioData.effectiveEnergy = numberValue(shared.energy);
      audioData.energySource = "duplicate_group";
      nextProvenance.energy = fieldProvenance.energy;
      changed = true;
    }
    if (member.id !== fieldSources.mood?.track.id && shouldInheritDuplicateField(member, "mood") && typeof shared.mood === "number") {
      audioData.effectiveMood = shared.mood;
      audioData.valenceSource = "duplicate_group";
      nextProvenance.mood = fieldProvenance.mood;
      changed = true;
    }
    if (Object.keys(audioData).length) {
      await db.audioFeature.upsert({
        where: { trackId: member.id },
        create: { trackId: member.id, ...audioData, source: "duplicate_group", audioFeatureSource: "duplicate_group" },
        update: audioData,
      });
    }
    if (member.id !== fieldSources.mood?.track.id && shouldInheritDuplicateField(member, "mood") && Array.isArray(shared.mood) && shared.mood.length) {
      await db.track.update({
        where: { id: member.id },
        data: { tags: { connectOrCreate: shared.mood.map((name: string) => ({ where: { type_name: { type: "mood", name } }, create: { type: "mood", name } })) } },
      });
      nextProvenance.mood = fieldProvenance.mood;
      changed = true;
    }
    if (changed) {
      inherited += 1;
      await db.track.update({ where: { id: member.id }, data: { enrichmentProvenance: json(nextProvenance) } });
    }
  }
  return { inherited, sourceTrackId: source.id };
}

export async function refreshCanonicalEnrichmentForTrack(trackId: string) {
  const track = await prisma.track.findUnique({ where: { id: trackId }, select: { canonicalRecordingId: true, library: { select: { server: { select: { userId: true } } } } } });
  if (!track?.canonicalRecordingId) return { inherited: 0, sourceTrackId: null };
  const settings = await prisma.syncSettings.findUnique({ where: { userId: track.library.server.userId }, select: { automaticallyShareDuplicateEnrichment: true } });
  if (settings?.automaticallyShareDuplicateEnrichment === false) return { inherited: 0, sourceTrackId: null };
  return refreshCanonicalEnrichment(track.canonicalRecordingId, trackId);
}

export async function assignConfirmedDuplicateGroup(input: {
  libraryId: string;
  trackId: string;
  candidateTrackId: string;
  assessment: DuplicateAssessment;
  automaticallyShare?: boolean;
  db?: any;
}) {
  const execute = async (tx: any) => {
    const candidate = await tx.track.findFirst({ where: { id: input.candidateTrackId, libraryId: input.libraryId }, select: { id: true, canonicalRecordingId: true, title: true, artist: { select: { title: true } } } });
    const track = await tx.track.findFirst({ where: { id: input.trackId, libraryId: input.libraryId }, select: { id: true, title: true, artist: { select: { title: true } } } });
    if (!candidate || !track) throw new Error("Duplicate group member not found");
    const group = candidate.canonicalRecordingId
      ? await tx.canonicalRecording.findUniqueOrThrow({ where: { id: candidate.canonicalRecordingId } })
      : await tx.canonicalRecording.create({ data: {
        libraryId: input.libraryId,
        canonicalArtist: candidate.artist.title,
        canonicalTitle: candidate.title,
        confidence: input.assessment.confidence,
        matchEvidence: json(input.assessment.evidence),
        reviewStatus: "confirmed",
        inheritanceEnabled: input.automaticallyShare !== false,
      } });
    await tx.track.updateMany({
      where: { id: { in: [candidate.id, track.id] }, libraryId: input.libraryId },
      data: {
        canonicalRecordingId: group.id,
        duplicateConfidence: input.assessment.confidence,
        duplicateMatchEvidence: json(input.assessment.evidence),
        duplicateReviewStatus: "confirmed",
      },
    });
    return group;
  };
  const result = input.db ? await execute(input.db) : await prisma.$transaction(execute);
  const inherited = input.automaticallyShare === false ? { inherited: 0, sourceTrackId: null } : await refreshCanonicalEnrichment(result.id, undefined, input.db || prisma);
  return { groupId: result.id, ...inherited };
}

export async function splitTrackFromDuplicateGroup(trackId: string) {
  const track = await prisma.track.update({
    where: { id: trackId },
    data: { canonicalRecordingId: null, duplicateConfidence: null, duplicateMatchEvidence: Prisma.JsonNull, duplicateReviewStatus: "not_duplicate", enrichmentProvenance: Prisma.JsonNull },
    select: { canonicalRecordingId: true },
  });
  return track;
}
