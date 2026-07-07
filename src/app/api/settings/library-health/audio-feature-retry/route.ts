import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { safeRecordJobHistory } from "@/lib/jobHistory";
import {
  audioFeatureAnalyzerFailedTrackWhere,
  audioFeatureExtractionFailedTrackWhere,
  audioFeatureNoDataTrackWhere,
  audioFeatureRetryEligibilityTrackWhere,
  audioFeatureTooShortTrackWhere,
  completeAudioFeatureTrackWhere,
  type EffectiveAudioFeatureSettings,
  localEssentiaAudioFeatureSuccessTrackWhere,
  partialAudioFeatureTrackWhere,
} from "@/lib/audioFeatures";
import { buildAudioFeatureHealthQuery, invalidateLibraryHealthCache, isAudioFeatureHealthFilter } from "@/lib/libraryHealth";
import { resolveLibraryHealthTrackIds } from "@/lib/libraryHealthDetails";
import { buildRetryExplanation } from "@/lib/retryExplanations";
import { getUserSyncSettings, resolveMetadataProviderSettings } from "@/lib/syncSettings";

const requestSchema = z.object({
  trackIds: z.array(z.string().uuid()).max(10_000).optional(),
  filter: z.string().optional(),
  libraryId: z.string().uuid().optional(),
  force: z.boolean().default(false),
  providerMode: z.enum(["configured", "api_only", "local_only", "force_local"]).default("configured"),
}).refine((body) => (body.trackIds?.length || 0) > 0 || !!body.filter, {
  message: "Provide trackIds or a filter",
});

async function countAudioFeatureSkipReasons(baseWhere: Prisma.TrackWhereInput, candidateWhere: Prisma.TrackWhereInput, analysisScope?: string | null, settings?: EffectiveAudioFeatureSettings) {
  const reasons: Record<string, number> = {};
  const exclusions: Prisma.TrackWhereInput[] = [candidateWhere];
  const countReason = async (name: string, reasonWhere: Prisma.TrackWhereInput) => {
    const value = await prisma.track.count({ where: { AND: [baseWhere, { NOT: exclusions }, reasonWhere] } });
    if (value > 0) reasons[name] = value;
    exclusions.push(reasonWhere);
  };

  await countReason("already_has_complete_audio_features", completeAudioFeatureTrackWhere(settings));
  await countReason("already_has_complete_local_audio_features", localEssentiaAudioFeatureSuccessTrackWhere(analysisScope));
  await countReason("too_short", audioFeatureTooShortTrackWhere(settings));
  await countReason("failed_previous_attempt", {
    OR: [
      audioFeatureNoDataTrackWhere(settings),
      audioFeatureExtractionFailedTrackWhere(settings),
      audioFeatureAnalyzerFailedTrackWhere(settings),
    ],
  });
  await countReason("partial_but_not_eligible", partialAudioFeatureTrackWhere(settings));
  return reasons;
}

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid retry request" }, { status: 400 });
    }
    const { trackIds, filter, libraryId, force, providerMode } = parsed.data;
    const syncSettings = resolveMetadataProviderSettings(await getUserSyncSettings(userId)).audioFeatures;
    const resolvedFilter = isAudioFeatureHealthFilter(filter) ? filter : null;
    if (!trackIds?.length && !resolvedFilter) {
      return NextResponse.json({ error: "A valid audio-feature health filter is required" }, { status: 400 });
    }
    const activeScope = {
      syncStatus: "active",
      library: { ...(libraryId ? { id: libraryId } : {}), server: { userId } },
    };
    const resolved = !trackIds?.length && (
      resolvedFilter === "missing_audio_features"
      || resolvedFilter === "pending_audio_features"
      || resolvedFilter === "partial_audio_features"
    )
      ? await resolveLibraryHealthTrackIds(userId, {
        category: resolvedFilter,
        libraryId,
        settings: syncSettings,
      })
      : null;
    const targetQuery = trackIds?.length
      ? {
        where: { AND: [activeScope, { id: { in: trackIds } }] },
        gapTrackIds: [] as string[],
      }
      : resolved
        ? {
          where: {
            AND: [
              activeScope,
              resolved.trackIds.length ? { id: { in: resolved.trackIds } } : { id: "__library_health_empty_resolved_track_set__" },
            ],
          },
          gapTrackIds: Object.keys(resolved.reasonByTrackId || {}),
        }
      : await buildAudioFeatureHealthQuery(userId, {
        filter: resolvedFilter!,
        libraryId,
        settings: syncSettings,
      });
    const targetScopedWhere = targetQuery.where;
    const gapRetryWhere: Prisma.TrackWhereInput | null = targetQuery.gapTrackIds.length
      ? { id: { in: targetQuery.gapTrackIds } }
      : null;
    const where = {
      AND: [
        targetScopedWhere,
        force || providerMode === "force_local"
          ? {}
          : {
            OR: [
              audioFeatureRetryEligibilityTrackWhere({
                force,
                providerMode,
                analysisScope: syncSettings.scope,
                settings: syncSettings,
              }),
              ...(gapRetryWhere ? [gapRetryWhere] : []),
            ],
          },
      ],
    };
    const originalCount = await prisma.track.count({ where: targetScopedWhere });
    const matching = await prisma.track.findMany({
      where,
      select: { id: true, title: true, artist: { select: { title: true } } },
    });
    const ids = matching.map((track) => track.id);
    const skippedAlreadyFixed = Math.max(0, originalCount - ids.length);
    const skipReasons = skippedAlreadyFixed > 0 ? await countAudioFeatureSkipReasons(targetScopedWhere, where, syncSettings.scope, syncSettings) : {};
    const knownSkipped = Object.values(skipReasons).reduce((sum, value) => sum + value, 0);
    if (skippedAlreadyFixed > knownSkipped) skipReasons.not_eligible_for_mode = skippedAlreadyFixed - knownSkipped;
    const retryExplanation = buildRetryExplanation({
      retryType: "audio-feature",
      filter: filter || "selected_tracks",
      matched: originalCount,
      queued: ids.length,
      skipped: skippedAlreadyFixed,
      skipReasons,
      mode: providerMode,
    });

    for (let offset = 0; offset < ids.length; offset += 5_000) {
      const chunk = ids.slice(offset, offset + 5_000);
      await prisma.$transaction([
        prisma.audioFeature.createMany({
          data: chunk.map((trackId) => ({ trackId, audioFeatureStatus: "pending" })),
          skipDuplicates: true,
        }),
        prisma.audioFeature.updateMany({
          where: { trackId: { in: chunk } },
          data: {
            audioFeatureStatus: "pending",
            audioFeatureFailureReason: null,
          },
        }),
      ]);
    }
    await invalidateLibraryHealthCache(userId, { libraryId, reason: "audio_feature_retry_queued" });
    revalidatePath("/");
    revalidatePath("/library-health");
    revalidatePath("/settings/library-health");

    if (trackIds?.length && matching.length === 1) {
      console.log(`[LibraryHealth] Queued audio-feature retry for track: ${matching[0].artist.title} - ${matching[0].title}`);
    } else {
      console.log(`[LibraryHealth] audio-feature retry filter=${filter || "selected_tracks"} matched=${originalCount} queued=${ids.length} skipped=${skippedAlreadyFixed} reason="${retryExplanation.logReason}"`);
      if (Object.keys(skipReasons).length) {
        console.log(`[LibraryHealth] audio-feature retry skip reasons: ${Object.entries(skipReasons).map(([reason, value]) => `${reason}=${value}`).join(", ")}`);
      }
    }
    await safeRecordJobHistory({
      userId,
      type: "audio_features",
      name: "Audio feature retry",
      status: "success",
      trigger: "retry",
      summary: retryExplanation.message,
      counts: { attempted: originalCount, processed: matching.length, skipped: skippedAlreadyFixed, failed: 0 },
      metadata: {
        retryType: "audio-feature",
        filter: filter || "selected_tracks",
        matched: originalCount,
        queued: ids.length,
        skipped: skippedAlreadyFixed,
        skipReasons,
        mode: providerMode,
        explanation: retryExplanation.explanation,
        libraryId: libraryId || null,
        providerMode,
        force,
      },
    });
    return NextResponse.json({
      queued: ids.length,
      trackIds: ids,
      providerMode,
      retryType: "audio-feature",
      before: originalCount,
      skipped: skippedAlreadyFixed,
      skippedAlreadyFixed,
      filter: filter || "selected_tracks",
      matched: originalCount,
      skipReasons,
      summary: retryExplanation.summary,
      explanation: retryExplanation.explanation,
      message: retryExplanation.message,
    });
  } catch (error) {
    console.error("[LibraryHealth] Failed to queue audio-feature retry", error);
    await safeRecordJobHistory({
      userId,
      type: "audio_features",
      name: "Audio feature retry",
      status: "failed",
      trigger: "retry",
      summary: "Audio-feature retry queue failed.",
      error,
    });
    return NextResponse.json({ error: "Failed to queue audio-feature retry" }, { status: 500 });
  }
}
