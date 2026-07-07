import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { safeRecordJobHistory } from "@/lib/jobHistory";
import {
  bpmHealthFilterClassification,
  buildBpmRetryBaseWhere,
  buildBpmRetryCandidateWhere,
  isBpmHealthFilter,
} from "@/lib/libraryHealth";
import {
  bpmAnalyzerFailedMarkerTrackWhere,
  bpmExtractionFailedMarkerTrackWhere,
  bpmFailedMarkerTrackWhere,
  bpmNoDataMarkerTrackWhere,
  bpmTooShortMarkerTrackWhere,
  localEssentiaBpmSuccessTrackWhere,
  missingEffectiveBpmTrackWhere,
} from "@/lib/bpm";
import { buildRetryExplanation } from "@/lib/retryExplanations";

const requestSchema = z.object({
  trackIds: z.array(z.string().uuid()).max(10_000).optional(),
  filter: z.string().optional(),
  libraryId: z.string().uuid().optional(),
  force: z.boolean().default(false),
  providerMode: z.enum(["configured", "api_only", "local_only", "force_local"]).default("configured"),
}).refine((body) => (body.trackIds?.length || 0) > 0 || !!body.filter, {
  message: "Provide trackIds or a filter",
});

async function countBpmSkipReasons(baseWhere: Prisma.TrackWhereInput, candidateWhere: Prisma.TrackWhereInput) {
  const reasons: Record<string, number> = {};
  const exclusions: Prisma.TrackWhereInput[] = [candidateWhere];
  const countReason = async (name: string, reasonWhere: Prisma.TrackWhereInput) => {
    const value = await prisma.track.count({ where: { AND: [baseWhere, { NOT: exclusions }, reasonWhere] } });
    if (value > 0) reasons[name] = value;
    exclusions.push(reasonWhere);
  };

  await countReason("already_has_local_bpm", localEssentiaBpmSuccessTrackWhere());
  await countReason("not_missing_bpm", { NOT: missingEffectiveBpmTrackWhere() });
  await countReason("failed_previous_attempt", {
    OR: [
      bpmNoDataMarkerTrackWhere(),
      bpmFailedMarkerTrackWhere(),
      bpmExtractionFailedMarkerTrackWhere(),
      bpmAnalyzerFailedMarkerTrackWhere(),
      bpmTooShortMarkerTrackWhere(),
    ],
  });
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
    if (!trackIds?.length && !isBpmHealthFilter(filter)) {
      return NextResponse.json({ error: "A valid BPM health filter is required" }, { status: 400 });
    }
    const resolvedFilter = isBpmHealthFilter(filter) ? filter : "missing_bpm";
    const localOnly = providerMode === "local_only" || providerMode === "force_local";
    const healthWhere = buildBpmRetryBaseWhere(userId, {
      filter: resolvedFilter,
      libraryId,
      trackIds,
    });
    const where = buildBpmRetryCandidateWhere(userId, {
      filter: resolvedFilter,
      libraryId,
      trackIds,
      force,
      providerMode,
    });
    const [healthCount, retryCandidateCount] = await Promise.all([
      prisma.track.count({ where: healthWhere }),
      prisma.track.count({ where }),
    ]);
    console.log(
      `[LibraryHealth] BPM retry requested filter=${resolvedFilter} force=${force} localOnly=${localOnly} classification=${bpmHealthFilterClassification(resolvedFilter)}`,
    );
    console.log(`[LibraryHealth] BPM health count for ${resolvedFilter}=${healthCount}`);
    console.log(`[LibraryHealth] BPM retry candidates for ${resolvedFilter}=${retryCandidateCount}`);
    if (healthCount > 0 && retryCandidateCount === 0) {
      const samples = await prisma.track.findMany({
        where: healthWhere,
        select: { id: true, ratingKey: true, title: true, artist: { select: { title: true } } },
        take: 5,
        orderBy: { id: "asc" },
      });
      console.warn(
        `[LibraryHealth] WARNING: BPM filter mismatch. healthCount=${healthCount} retryCandidates=${retryCandidateCount} filter=${resolvedFilter} sampleTrackIds=${samples.map((track) => track.id).join(",")}`,
      );
    }
    const matching = await prisma.track.findMany({
      where,
      select: { id: true, title: true, artist: { select: { title: true } } },
    });
    const ids = matching.map((track) => track.id);
    const skipped = Math.max(0, healthCount - ids.length);
    const skipReasons = skipped > 0 ? await countBpmSkipReasons(healthWhere, where) : {};
    const knownSkipped = Object.values(skipReasons).reduce((sum, value) => sum + value, 0);
    if (skipped > knownSkipped) skipReasons.not_eligible_for_mode = skipped - knownSkipped;
    const retryExplanation = buildRetryExplanation({
      retryType: "BPM",
      filter: filter || "selected_tracks",
      matched: healthCount,
      queued: ids.length,
      skipped,
      skipReasons,
      mode: providerMode,
    });

    for (let offset = 0; offset < ids.length; offset += 5_000) {
      const chunk = ids.slice(offset, offset + 5_000);
      await prisma.$transaction([
        prisma.track.updateMany({
          where: { id: { in: chunk } },
          data: {
            bpmAnalysisStatus: null,
            bpmFailureReason: null,
            bpmAnalyzedAt: null,
          },
        }),
        prisma.audioFeature.updateMany({
          where: { trackId: { in: chunk } },
          data: {
            tempoSource: null,
            tempoConfidence: null,
          },
        }),
      ]);
    }
    revalidatePath("/");
    revalidatePath("/data-enrichment");
    revalidatePath("/library-health");
    revalidatePath("/settings/library-health");

    if (trackIds?.length && matching.length === 1) {
      console.log(`[LibraryHealth] Queued BPM retry for track: ${matching[0].artist.title} - ${matching[0].title}`);
    } else {
      console.log(`[LibraryHealth] BPM retry filter=${filter || "selected_tracks"} matched=${healthCount} queued=${ids.length} skipped=${skipped} reason="${retryExplanation.logReason}"`);
      if (Object.keys(skipReasons).length) {
        console.log(`[LibraryHealth] BPM retry skip reasons: ${Object.entries(skipReasons).map(([reason, value]) => `${reason}=${value}`).join(", ")}`);
      }
    }
    await safeRecordJobHistory({
      userId,
      type: "bpm",
      name: "BPM retry",
      status: "success",
      trigger: "retry",
      summary: retryExplanation.message,
      counts: { attempted: healthCount, processed: ids.length, skipped, failed: 0 },
      metadata: {
        retryType: "BPM",
        filter: filter || "selected_tracks",
        matched: healthCount,
        queued: ids.length,
        skipped,
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
      retryType: "BPM",
      filter: filter || "selected_tracks",
      matched: healthCount,
      skipped,
      skipReasons,
      summary: retryExplanation.summary,
      explanation: retryExplanation.explanation,
      message: retryExplanation.message,
    });
  } catch (error) {
    console.error("[LibraryHealth] Failed to queue BPM retry", error);
    await safeRecordJobHistory({
      userId,
      type: "bpm",
      name: "BPM retry",
      status: "failed",
      trigger: "retry",
      summary: "BPM retry queue failed.",
      error,
    });
    return NextResponse.json({ error: "Failed to queue BPM retry" }, { status: 500 });
  }
}
