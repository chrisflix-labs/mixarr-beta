import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { runAudioFeatureRetry } from "@/lib/audioFeatureRetry";
import {
  buildBpmRetryBaseWhere,
  buildBpmRetryCandidateWhere,
  invalidateLibraryHealthCache,
  isAudioFeatureHealthFilter,
  isBpmHealthFilter,
  type AudioFeatureHealthFilter,
  type BpmHealthFilter,
} from "@/lib/libraryHealth";
import {
  isLibraryHealthDetailCategory,
  libraryHealthDetailLabels,
  type LibraryHealthDetailCategory,
} from "@/lib/libraryHealthDetails";
import { safeRecordJobHistory } from "@/lib/jobHistory";
import { buildRetryExplanation } from "@/lib/retryExplanations";
import { getUserSyncSettings, resolveMetadataProviderSettings } from "@/lib/syncSettings";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  retryType: z.enum(["bpm", "audio_features"]).optional(),
  category: z.string().optional(),
  filter: z.string().optional(),
  trackIds: z.array(z.string().uuid()).max(10_000).optional(),
  libraryId: z.string().uuid().optional(),
  mode: z.string().optional(),
  providerMode: z.string().default("configured"),
  force: z.boolean().default(false),
}).refine((body) => !!body.retryType || !!body.category || !!body.filter || (body.trackIds?.length || 0) > 0, {
  message: "Provide a retry type, category, filter, or selected tracks",
});

function bpmFilterFor(category: LibraryHealthDetailCategory | null, filter?: string): BpmHealthFilter {
  if (isBpmHealthFilter(filter)) return filter;
  if (category === "api_bpm") return "api_bpm";
  if (category === "local_bpm") return "local_bpm";
  if (category === "failed_bpm_analysis") return "bpm_failed";
  if (category === "too_short") return "too_short";
  return "missing_bpm";
}

function audioFilterFor(category: LibraryHealthDetailCategory | null, filter?: string): AudioFeatureHealthFilter {
  if (isAudioFeatureHealthFilter(filter)) return filter;
  if (category === "partial_audio_features") return "partial_audio_features";
  if (category === "pending_audio_features") return "pending_audio_features";
  if (category === "failed_audio_feature_analysis") return "audio_feature_failed";
  if (category === "too_short") return "too_short";
  return "missing_audio_features";
}

function retryTypeFor(category: LibraryHealthDetailCategory | null, requested?: "bpm" | "audio_features") {
  if (requested) return requested;
  if (category === "missing_audio_features" || category === "partial_audio_features" || category === "pending_audio_features" || category === "complete_audio_features" || category === "failed_audio_feature_analysis") {
    return "audio_features";
  }
  return "bpm";
}

function bpmProviderModeFor(value?: string): "configured" | "api_only" | "local_only" | "force_local" {
  if (value === "api_only" || value === "local_only" || value === "force_local") return value;
  if (value === "force_local_reprocess") return "force_local";
  return "configured";
}

function manualSummary(categoryLabel: string, queued: number, matched: number) {
  if (queued === 0) {
    return `Manual Library Health retry for ${categoryLabel} queued 0 tracks. No eligible tracks matched the selected retry mode.`;
  }
  return `Manual Library Health retry for ${categoryLabel} queued ${queued.toLocaleString()} track${queued === 1 ? "" : "s"} out of ${matched.toLocaleString()} matched.`;
}

async function runBpmRetry(userId: string, input: {
  category: LibraryHealthDetailCategory | null;
  filter?: string;
  trackIds?: string[];
  libraryId?: string;
  providerMode: string;
  force: boolean;
}) {
  const filter = bpmFilterFor(input.category, input.filter);
  const providerMode = bpmProviderModeFor(input.providerMode);
  const baseWhere = input.trackIds?.length
    ? {
        AND: [
          { id: { in: input.trackIds } },
          { syncStatus: "active", library: { ...(input.libraryId ? { id: input.libraryId } : {}), server: { userId } } },
        ],
      }
    : buildBpmRetryBaseWhere(userId, { filter, libraryId: input.libraryId });
  const candidateWhere = buildBpmRetryCandidateWhere(userId, {
    filter,
    libraryId: input.libraryId,
    trackIds: input.trackIds,
    providerMode,
    force: input.force,
  });
  const [matched, matching] = await Promise.all([
    prisma.track.count({ where: baseWhere }),
    prisma.track.findMany({ where: candidateWhere, select: { id: true } }),
  ]);
  const ids = matching.map((track) => track.id);
  const skipped = Math.max(0, matched - ids.length);
  const explanation = buildRetryExplanation({
    retryType: "BPM",
    filter: input.filter || input.category || "selected_tracks",
    matched,
    queued: ids.length,
    skipped,
    skipReasons: skipped ? { not_eligible_for_mode: skipped } : {},
    mode: providerMode,
  });

  for (let offset = 0; offset < ids.length; offset += 5_000) {
    const chunk = ids.slice(offset, offset + 5_000);
    await prisma.$transaction([
      prisma.track.updateMany({
        where: { id: { in: chunk } },
        data: { bpmAnalysisStatus: null, bpmFailureReason: null, bpmAnalyzedAt: null },
      }),
      prisma.audioFeature.updateMany({
        where: { trackId: { in: chunk } },
        data: { tempoSource: null, tempoConfidence: null },
      }),
    ]);
  }
  await invalidateLibraryHealthCache(userId, { libraryId: input.libraryId, reason: "library_health_audio_feature_retry_queued" });

  const categoryLabel = input.category ? libraryHealthDetailLabels[input.category] : filter;
  const summary = manualSummary(categoryLabel, ids.length, matched);
  await safeRecordJobHistory({
    userId,
    type: "bpm",
    name: "Manual Library Health BPM retry",
    status: "success",
    trigger: "manual",
    summary: ids.length === 0 ? `${summary} ${explanation.explanation}` : summary,
    counts: { attempted: matched, processed: ids.length, skipped, failed: 0 },
    metadata: {
      source: "library_health_details",
      retryType: "BPM",
      filter: input.filter || input.category || "selected_tracks",
      category: input.category,
      matched,
      queued: ids.length,
      skipped,
      reasonSummary: explanation.summary,
      explanation: explanation.explanation,
      providerMode,
      libraryId: input.libraryId || null,
    },
  });
  return { queued: ids.length, matched, skipped, trackIds: ids, summary, explanation: explanation.explanation, retryType: "BPM", filter };
}

async function runAudioRetry(userId: string, input: {
  category: LibraryHealthDetailCategory | null;
  filter?: string;
  trackIds?: string[];
  libraryId?: string;
  providerMode: string;
  mode?: string;
  force: boolean;
}) {
  const filter = audioFilterFor(input.category, input.filter);
  const syncSettings = resolveMetadataProviderSettings(await getUserSyncSettings(userId)).audioFeatures;
  return runAudioFeatureRetry(userId, {
    filter,
    trackIds: input.trackIds,
    libraryId: input.libraryId,
    mode: input.mode || input.providerMode,
    providerMode: input.providerMode,
    force: input.force,
  }, syncSettings);
}

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid retry request" }, { status: 400 });
    }
    const category = isLibraryHealthDetailCategory(parsed.data.category) ? parsed.data.category : null;
    const retryType = retryTypeFor(category, parsed.data.retryType);
    const result = retryType === "audio_features"
      ? await runAudioRetry(userId, { ...parsed.data, category })
      : await runBpmRetry(userId, { ...parsed.data, category });

    revalidatePath("/");
    revalidatePath("/library-health");
    revalidatePath("/settings/library-health");
    return NextResponse.json(result);
  } catch (error) {
    console.error("[LibraryHealthDetails] Failed to queue manual retry", error);
    await safeRecordJobHistory({
      userId,
      type: "library_health",
      name: "Manual Library Health retry",
      status: "failed",
      trigger: "manual",
      summary: "Manual Library Health retry failed.",
      error,
    });
    return NextResponse.json({ error: "Failed to queue Library Health retry" }, { status: 500 });
  }
}
