import { Prisma, type PrismaClient } from "@prisma/client";
import prisma from "./prisma";
import {
  METADATA_SOURCES,
  bpmCorrectionSuggestions,
  isCorrectableMetadataField,
  normalizeMetadataSource,
  resolveEffectiveTrackMetadata,
  type CorrectableMetadataField,
} from "./metadataCorrections";
import { normalizeMoodList } from "./selectableMoods";
import { refreshCanonicalEnrichmentForTrack } from "./duplicateRecordings";

type Db = PrismaClient | Prisma.TransactionClient;

export class MetadataCorrectionError extends Error {
  constructor(message: string, public status = 400, public code = "INVALID_METADATA_CORRECTION") {
    super(message);
  }
}

export const ownedTrackMetadataInclude = {
  artist: { select: { title: true } },
  album: { select: { title: true } },
  tags: { where: { type: "mood" }, select: { type: true, name: true } },
  audioFeature: true,
  metadataCorrections: { orderBy: { updatedAt: "desc" as const } },
  metadataVerifications: { orderBy: { verifiedAt: "desc" as const } },
  metadataSourceOverrides: { orderBy: { updatedAt: "desc" as const } },
} as const;

export async function findOwnedTrackWithMetadata(userId: string, trackId: string, db: Db = prisma) {
  const track = await db.track.findFirst({
    where: { id: trackId, library: { server: { userId } } },
    include: ownedTrackMetadataInclude,
  });
  if (!track) throw new MetadataCorrectionError("Track not found", 404, "TRACK_NOT_FOUND");
  return track;
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function nullableJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : json(value);
}

export function validateCorrectionValue(field: CorrectableMetadataField, value: unknown): number | string[] {
  if (field === "bpm") {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number) || number <= 0 || number > 400) {
      throw new MetadataCorrectionError("BPM must be a number greater than 0 and no more than 400.", 400, "INVALID_BPM");
    }
    return Math.round(number * 100) / 100;
  }
  if (field === "energy") {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 1) {
      throw new MetadataCorrectionError("Energy must be between 0 and 1.", 400, "INVALID_ENERGY");
    }
    return Math.round(number * 1000) / 1000;
  }
  const moods = normalizeMoodList(Array.isArray(value) ? value : [value]).map((mood) => mood.name).slice(0, 12);
  if (!moods.length) throw new MetadataCorrectionError("Select at least one valid mood.", 400, "INVALID_MOOD");
  return moods;
}

function fieldValue(resolved: ReturnType<typeof resolveEffectiveTrackMetadata>, field: CorrectableMetadataField) {
  return resolved[field].value;
}

function historyData(input: {
  trackId: string; field: CorrectableMetadataField; action: string; userId: string; oldValue?: unknown;
  newValue?: unknown; source?: string; reason?: string | null; batchId?: string;
}) {
  return {
    trackId: input.trackId,
    field: input.field,
    action: input.action,
    ...(input.oldValue !== undefined ? { oldValueJson: nullableJson(input.oldValue) } : {}),
    ...(input.newValue !== undefined ? { newValueJson: nullableJson(input.newValue) } : {}),
    source: input.source,
    reason: input.reason?.trim().slice(0, 500) || null,
    batchId: input.batchId,
    createdBy: input.userId,
  };
}

async function writeCorrection(db: Prisma.TransactionClient, input: {
  track: Awaited<ReturnType<typeof findOwnedTrackWithMetadata>>; userId: string; field: CorrectableMetadataField;
  value: unknown; reason?: string | null; verified?: boolean; batchId?: string;
}) {
  const oldResolved = resolveEffectiveTrackMetadata(input.track);
  const normalized = validateCorrectionValue(input.field, input.value);
  const existing = input.track.metadataCorrections.find((correction) => correction.field === input.field && correction.isActive);
  if (existing) await db.trackMetadataCorrection.update({ where: { id: existing.id }, data: { isActive: false } });
  const correction = await db.trackMetadataCorrection.create({ data: {
    trackId: input.track.id, field: input.field, valueJson: json(normalized),
    previousEffectiveValueJson: nullableJson(fieldValue(oldResolved, input.field)),
    reason: input.reason?.trim().slice(0, 500) || null,
    isVerified: input.verified !== false, createdBy: input.userId,
  } });
  await db.trackMetadataCorrectionHistory.create({ data: historyData({
    trackId: input.track.id, field: input.field, action: existing ? "correction_changed" : "correction_created",
    userId: input.userId, oldValue: fieldValue(oldResolved, input.field), newValue: normalized,
    source: "manual", reason: input.reason, batchId: input.batchId,
  }) });
  return correction;
}

export async function setTrackMetadataCorrection(input: {
  userId: string; trackId: string; field: unknown; value: unknown; reason?: string | null; verified?: boolean;
}) {
  if (!isCorrectableMetadataField(input.field)) throw new MetadataCorrectionError("Unsupported metadata field.", 400, "INVALID_FIELD");
  const field = input.field;
  await prisma.$transaction(async (tx) => {
    const track = await findOwnedTrackWithMetadata(input.userId, input.trackId, tx);
    await writeCorrection(tx, { ...input, field, track });
  });
  await refreshCanonicalEnrichmentForTrack(input.trackId);
  return getTrackMetadataCorrectionDetails(input.userId, input.trackId);
}

export async function removeTrackMetadataCorrection(userId: string, trackId: string, field: unknown, reason?: string | null) {
  if (!isCorrectableMetadataField(field)) throw new MetadataCorrectionError("Unsupported metadata field.", 400, "INVALID_FIELD");
  await prisma.$transaction(async (tx) => {
    const track = await findOwnedTrackWithMetadata(userId, trackId, tx);
    const existing = track.metadataCorrections.find((correction) => correction.field === field && correction.isActive);
    if (!existing) throw new MetadataCorrectionError("No active correction exists for this field.", 404, "CORRECTION_NOT_FOUND");
    await tx.trackMetadataCorrection.update({ where: { id: existing.id }, data: { isActive: false } });
    const without = { ...track, metadataCorrections: track.metadataCorrections.map((item) => item.id === existing.id ? { ...item, isActive: false } : item) };
    await tx.trackMetadataCorrectionHistory.create({ data: historyData({
      trackId, field, action: "correction_removed", userId, oldValue: existing.valueJson,
      newValue: fieldValue(resolveEffectiveTrackMetadata(without), field), source: "manual", reason,
    }) });
  });
  await refreshCanonicalEnrichmentForTrack(trackId);
  return getTrackMetadataCorrectionDetails(userId, trackId);
}

function sourceAvailable(track: any, field: CorrectableMetadataField, source: string) {
  const normalized = normalizeMetadataSource(source);
  if (source === "manual") return track.metadataCorrections.some((item: any) => item.field === field && item.isActive);
  if (field === "bpm") {
    if (normalized === "api") return track.apiBpm != null;
    if (normalized === "local") return track.localBpm != null;
    return track.bpm != null || track.effectiveBpm != null || track.audioFeature?.tempo != null;
  }
  if (field === "energy") {
    if (normalized === "api") return track.audioFeature?.apiEnergy != null;
    if (normalized === "local") return track.audioFeature?.localEnergy != null;
    return track.audioFeature?.energy != null || track.audioFeature?.effectiveEnergy != null;
  }
  if (normalized === "api") return track.audioFeature?.apiMood != null;
  if (normalized === "local") return track.audioFeature?.localMood != null;
  return track.tags.length > 0 || track.audioFeature?.effectiveMood != null || track.audioFeature?.valence != null;
}

export async function setMetadataVerification(input: {
  userId: string; trackId: string; field: unknown; source: unknown; verified: boolean; note?: string | null;
}) {
  if (!isCorrectableMetadataField(input.field)) throw new MetadataCorrectionError("Unsupported metadata field.", 400, "INVALID_FIELD");
  const field = input.field;
  const source = normalizeMetadataSource(input.source);
  if (source !== "manual" && (!METADATA_SOURCES.includes(source as any) || source === "fallback")) {
    throw new MetadataCorrectionError("Unsupported metadata source.", 400, "INVALID_SOURCE");
  }
  await prisma.$transaction(async (tx) => {
    const track = await findOwnedTrackWithMetadata(input.userId, input.trackId, tx);
    if (input.verified && !sourceAvailable(track, field, source)) {
      throw new MetadataCorrectionError("That source has no value available to verify.", 400, "SOURCE_VALUE_MISSING");
    }
    const manualCorrection = source === "manual" ? track.metadataCorrections.find((item) => item.field === field && item.isActive) : null;
    if (manualCorrection) {
      await tx.trackMetadataCorrection.update({ where: { id: manualCorrection.id }, data: { isVerified: input.verified } });
    } else if (input.verified) {
      await tx.trackMetadataVerification.upsert({
        where: { trackId_field_source: { trackId: input.trackId, field, source } },
        create: { trackId: input.trackId, field, source, verified: true, verifiedBy: input.userId, note: input.note?.trim().slice(0, 500) || null },
        update: { verified: true, verifiedAt: new Date(), verifiedBy: input.userId, note: input.note?.trim().slice(0, 500) || null },
      });
    } else {
      await tx.trackMetadataVerification.updateMany({ where: { trackId: input.trackId, field, source }, data: { verified: false } });
    }
    await tx.trackMetadataCorrectionHistory.create({ data: historyData({
      trackId: input.trackId, field, action: input.verified ? "verification_added" : "verification_removed",
      userId: input.userId, source, reason: input.note,
    }) });
  });
  if (input.verified) await refreshCanonicalEnrichmentForTrack(input.trackId);
  return getTrackMetadataCorrectionDetails(input.userId, input.trackId);
}

export async function setMetadataSourceIgnored(input: {
  userId: string; trackId: string; field: unknown; source: unknown; ignored: boolean; reason?: string | null;
}) {
  if (!isCorrectableMetadataField(input.field)) throw new MetadataCorrectionError("Unsupported metadata field.", 400, "INVALID_FIELD");
  const field = input.field;
  const source = normalizeMetadataSource(input.source);
  if (!METADATA_SOURCES.includes(source as any) || source === "fallback") {
    throw new MetadataCorrectionError("Unsupported metadata source.", 400, "INVALID_SOURCE");
  }
  await prisma.$transaction(async (tx) => {
    const track = await findOwnedTrackWithMetadata(input.userId, input.trackId, tx);
    if (input.ignored && !sourceAvailable(track, field, source)) {
      throw new MetadataCorrectionError("That source has no stored value to ignore.", 400, "SOURCE_VALUE_MISSING");
    }
    await tx.trackMetadataSourceOverride.upsert({
      where: { trackId_field_source: { trackId: input.trackId, field, source } },
      create: { trackId: input.trackId, field, source, ignored: input.ignored, reason: input.reason?.trim().slice(0, 500) || null },
      update: { ignored: input.ignored, reason: input.reason?.trim().slice(0, 500) || null },
    });
    await tx.trackMetadataCorrectionHistory.create({ data: historyData({
      trackId: input.trackId, field, action: input.ignored ? "source_ignored" : "source_restored",
      userId: input.userId, source, reason: input.reason,
    }) });
  });
  return getTrackMetadataCorrectionDetails(input.userId, input.trackId);
}

export async function getTrackMetadataCorrectionDetails(userId: string, trackId: string) {
  const track = await findOwnedTrackWithMetadata(userId, trackId);
  const effectiveMetadata = resolveEffectiveTrackMetadata(track);
  return {
    track: { id: track.id, title: track.title, artist: track.artist.title, album: track.album.title },
    effectiveMetadata,
    sources: {
      bpm: { api: track.apiBpm, local: track.localBpm, imported: track.bpm, effectiveStored: track.effectiveBpm, audio: track.audioFeature?.tempo ?? null },
      mood: { api: track.audioFeature?.apiMood ?? null, local: track.audioFeature?.localMood ?? null, embedded: track.tags.map((tag) => tag.name), effectiveStored: track.audioFeature?.effectiveMood ?? track.audioFeature?.valence ?? null },
      energy: { api: track.audioFeature?.apiEnergy ?? null, local: track.audioFeature?.localEnergy ?? null, embedded: track.audioFeature?.energy ?? null, effectiveStored: track.audioFeature?.effectiveEnergy ?? null },
    },
    corrections: track.metadataCorrections,
    verifications: track.metadataVerifications,
    sourceOverrides: track.metadataSourceOverrides,
    bpmSuggestions: bpmCorrectionSuggestions(track),
  };
}

export async function getTrackMetadataCorrectionHistory(userId: string, trackId: string) {
  await findOwnedTrackWithMetadata(userId, trackId);
  return prisma.trackMetadataCorrectionHistory.findMany({
    where: { trackId }, orderBy: { createdAt: "desc" }, take: 200,
    include: { actor: { select: { username: true } } },
  });
}

export function metadataCorrectionErrorResponse(error: unknown) {
  if (error instanceof MetadataCorrectionError) return { status: error.status, body: { error: error.message, code: error.code } };
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return { status: 409, body: { error: "This metadata field changed concurrently. Reload the track and try again.", code: "CONCURRENT_METADATA_UPDATE" } };
  }
  console.error("[MetadataCorrections] mutation failed", error);
  return { status: 500, body: { error: "Unable to update track metadata.", code: "METADATA_UPDATE_FAILED" } };
}

export { writeCorrection, historyData, fieldValue, sourceAvailable };
