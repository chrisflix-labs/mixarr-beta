import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { isCorrectableMetadataField, normalizeMetadataSource, resolveEffectiveTrackMetadata, type CorrectableMetadataField } from "@/lib/metadataCorrections";
import {
  MetadataCorrectionError,
  fieldValue,
  historyData,
  metadataCorrectionErrorResponse,
  ownedTrackMetadataInclude,
  sourceAvailable,
  validateCorrectionValue,
  writeCorrection,
} from "@/lib/metadataCorrectionService";
import { normalizeMoodList } from "@/lib/selectableMoods";

const operations = [
  "set", "adjust", "half", "double", "set_mood", "add_mood", "remove_mood", "replace_mood",
  "set_energy", "adjust_energy", "verify", "unverify", "ignore_source", "restore_source", "remove_correction",
] as const;

function normalizedMoods(value: unknown) {
  return normalizeMoodList(Array.isArray(value) ? value : [value]).map((mood) => mood.name);
}

function proposedValue(track: any, field: "bpm" | "mood" | "energy", operation: string, value: unknown) {
  const current = fieldValue(resolveEffectiveTrackMetadata(track), field);
  if (operation === "remove_correction" || operation === "verify" || operation === "unverify" || operation === "ignore_source" || operation === "restore_source") return current;
  if (operation === "half" && field === "bpm" && typeof current === "number") return validateCorrectionValue(field, current / 2);
  if (operation === "double" && field === "bpm" && typeof current === "number") return validateCorrectionValue(field, current * 2);
  if ((operation === "adjust" || operation === "adjust_energy") && typeof current === "number") return validateCorrectionValue(field, current + Number(value));
  if ((operation === "set" || operation === "set_mood" || operation === "set_energy")) return validateCorrectionValue(field, value);
  const currentMoods = Array.isArray(current) ? current : [];
  if (operation === "add_mood") return validateCorrectionValue("mood", [...currentMoods, ...normalizedMoods(value)]);
  if (operation === "remove_mood") {
    const removing = new Set(normalizedMoods(value).map((mood) => mood.toLowerCase()));
    return validateCorrectionValue("mood", currentMoods.filter((mood) => !removing.has(mood.toLowerCase())));
  }
  if (operation === "replace_mood") {
    const replacement = value && typeof value === "object" ? value as { from?: unknown; to?: unknown } : {};
    const removing = new Set(normalizedMoods(replacement.from).map((mood) => mood.toLowerCase()));
    return validateCorrectionValue("mood", [...currentMoods.filter((mood) => !removing.has(mood.toLowerCase())), ...normalizedMoods(replacement.to)]);
  }
  throw new MetadataCorrectionError("The selected operation cannot be applied to this field.", 400, "INVALID_BULK_OPERATION");
}

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  try {
    const body = await request.json();
    const trackIds = Array.from(new Set<string>(Array.isArray(body.trackIds) ? body.trackIds.filter((id: unknown): id is string => typeof id === "string") : [])).slice(0, 1000);
    if (!trackIds.length) throw new MetadataCorrectionError("Select at least one track.", 400, "NO_TRACKS_SELECTED");
    if (!isCorrectableMetadataField(body.field)) throw new MetadataCorrectionError("Unsupported metadata field.", 400, "INVALID_FIELD");
    const field = body.field as CorrectableMetadataField;
    if (!operations.includes(body.operation)) throw new MetadataCorrectionError("Unsupported bulk operation.", 400, "INVALID_BULK_OPERATION");
    const tracks = await prisma.track.findMany({
      where: { id: { in: trackIds }, library: { server: { userId } } },
      include: ownedTrackMetadataInclude,
    });
    if (tracks.length !== trackIds.length) throw new MetadataCorrectionError("One or more selected tracks were not found.", 404, "TRACK_NOT_FOUND");

    const previews = tracks.map((track) => {
      try {
        const oldValue = fieldValue(resolveEffectiveTrackMetadata(track), field);
        const nextValue = proposedValue(track, field, body.operation, body.value);
        const existingCorrection = track.metadataCorrections.some((item) => item.field === field && item.isActive);
        const requestedSource = normalizeMetadataSource(body.source || resolveEffectiveTrackMetadata(track)[field].source);
        const verification = track.metadataVerifications.find((item) => item.field === field && normalizeMetadataSource(item.source) === requestedSource);
        const manualCorrection = track.metadataCorrections.find((item) => item.field === field && item.isActive);
        const override = track.metadataSourceOverrides.find((item) => item.field === field && normalizeMetadataSource(item.source) === requestedSource);
        const changes = body.operation === "remove_correction" ? existingCorrection
          : body.operation === "verify" ? sourceAvailable(track, field, requestedSource) && (requestedSource === "manual" ? manualCorrection?.isVerified !== true : verification?.verified !== true)
          : body.operation === "unverify" ? (requestedSource === "manual" ? manualCorrection?.isVerified === true : verification?.verified === true)
          : body.operation === "ignore_source" ? requestedSource !== "manual" && sourceAvailable(track, field, requestedSource) && override?.ignored !== true
          : body.operation === "restore_source" ? override?.ignored === true
          : JSON.stringify(oldValue) !== JSON.stringify(nextValue) || !existingCorrection;
        return { trackId: track.id, title: track.title, oldValue, newValue: nextValue, changes, existingCorrection, warning: null as string | null };
      } catch (error) {
        return { trackId: track.id, title: track.title, oldValue: fieldValue(resolveEffectiveTrackMetadata(track), field), newValue: null, changes: false, existingCorrection: false, warning: error instanceof Error ? error.message : "Invalid value" };
      }
    });
    const summary = {
      selected: tracks.length,
      changing: previews.filter((item) => item.changes).length,
      skipped: previews.filter((item) => !item.changes).length,
      existingManualCorrectionsReplaced: previews.filter((item) => item.changes && item.existingCorrection && body.operation !== "remove_correction").length,
      warnings: previews.filter((item) => item.warning).map((item) => ({ trackId: item.trackId, warning: item.warning })),
    };
    if (body.confirm !== true) return NextResponse.json({ preview: true, field: body.field, operation: body.operation, summary, tracks: previews.slice(0, 100) });
    if (!summary.changing) {
      throw new MetadataCorrectionError("No selected tracks can be changed by this operation.", 400, "NO_CHANGES");
    }

    const batchId = crypto.randomUUID();
    await prisma.$transaction(async (tx) => {
      for (const preview of previews.filter((item) => item.changes)) {
        const track = tracks.find((item) => item.id === preview.trackId)!;
        if (body.operation === "remove_correction") {
          const correction = track.metadataCorrections.find((item) => item.field === field && item.isActive);
          if (!correction) continue;
          await tx.trackMetadataCorrection.update({ where: { id: correction.id }, data: { isActive: false } });
          const without = { ...track, metadataCorrections: track.metadataCorrections.map((item) => item.id === correction.id ? { ...item, isActive: false } : item) };
          await tx.trackMetadataCorrectionHistory.create({ data: historyData({ trackId: track.id, field, action: "correction_removed", userId, oldValue: correction.valueJson, newValue: fieldValue(resolveEffectiveTrackMetadata(without), field), reason: body.reason, batchId }) });
          continue;
        }
        if (body.operation === "verify" || body.operation === "unverify") {
          const verified = body.operation === "verify";
          const source = normalizeMetadataSource(body.source || resolveEffectiveTrackMetadata(track)[field].source);
          if (verified && !sourceAvailable(track, field, source)) continue;
          const manualCorrection = source === "manual" ? track.metadataCorrections.find((item) => item.field === field && item.isActive) : null;
          if (manualCorrection) await tx.trackMetadataCorrection.update({ where: { id: manualCorrection.id }, data: { isVerified: verified } });
          else await tx.trackMetadataVerification.upsert({
            where: { trackId_field_source: { trackId: track.id, field, source } },
            create: { trackId: track.id, field, source, verified, verifiedBy: userId, note: body.reason?.trim().slice(0, 500) || null },
            update: { verified, verifiedAt: new Date(), verifiedBy: userId, note: body.reason?.trim().slice(0, 500) || null },
          });
          await tx.trackMetadataCorrectionHistory.create({ data: historyData({ trackId: track.id, field, action: verified ? "verification_added" : "verification_removed", userId, source, reason: body.reason, batchId }) });
          continue;
        }
        if (body.operation === "ignore_source" || body.operation === "restore_source") {
          const ignored = body.operation === "ignore_source";
          const source = normalizeMetadataSource(body.source);
          if (!source || source === "manual" || (ignored && !sourceAvailable(track, field, source))) continue;
          await tx.trackMetadataSourceOverride.upsert({
            where: { trackId_field_source: { trackId: track.id, field, source } },
            create: { trackId: track.id, field, source, ignored, reason: body.reason?.trim().slice(0, 500) || null },
            update: { ignored, reason: body.reason?.trim().slice(0, 500) || null },
          });
          await tx.trackMetadataCorrectionHistory.create({ data: historyData({ trackId: track.id, field, action: ignored ? "source_ignored" : "source_restored", userId, source, reason: body.reason, batchId }) });
          continue;
        }
        await writeCorrection(tx, { track, userId, field, value: preview.newValue, reason: body.reason, verified: body.verified, batchId });
      }
    });
    return NextResponse.json({ success: true, batchId, summary });
  } catch (error) {
    const response = metadataCorrectionErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
