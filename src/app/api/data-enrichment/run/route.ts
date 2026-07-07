import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  dataEnrichmentActionConfigs,
  preflightDataEnrichmentAction,
  queueBpmRetry,
  queueMetadataRetry,
  type DataEnrichmentAction,
} from "@/lib/dataEnrichment";
import { runAudioFeatureRetry } from "@/lib/audioFeatureRetry";
import { getUserSyncSettings, resolveMetadataProviderSettings } from "@/lib/syncSettings";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  action: z.string(),
  libraryId: z.string().uuid().optional(),
});

function isDataEnrichmentAction(value: string): value is DataEnrichmentAction {
  return Object.prototype.hasOwnProperty.call(dataEnrichmentActionConfigs, value);
}

function revalidateEnrichmentViews() {
  revalidatePath("/");
  revalidatePath("/data-enrichment");
  revalidatePath("/library-health");
  revalidatePath("/settings/library-health");
  revalidatePath("/job-history");
}

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success || !isDataEnrichmentAction(parsed.data.action)) {
      return NextResponse.json({ error: "A valid Data Enrichment action is required" }, { status: 400 });
    }

    const action = parsed.data.action;
    const libraryId = parsed.data.libraryId;
    const config = dataEnrichmentActionConfigs[action];
    const preflight = await preflightDataEnrichmentAction(userId, action, { libraryId });

    if (!preflight.canRun) {
      return NextResponse.json({
        ...preflight,
        status: "noop",
        message: preflight.disabledReason || preflight.summary || "No matching tracks need this enrichment action.",
      });
    }

    if (preflight.enrichmentType === "audio_features" || preflight.enrichmentType === "local_audio_analysis") {
      const settings = resolveMetadataProviderSettings(await getUserSyncSettings(userId)).audioFeatures;
      const result = await runAudioFeatureRetry(userId, {
        filter: preflight.trackIds?.length && config.filter === "complete_audio_features" ? undefined : config.filter,
        trackIds: preflight.trackIds?.length && config.filter === "complete_audio_features" ? preflight.trackIds : undefined,
        libraryId,
        mode: config.mode,
        providerMode: config.mode,
        force: config.mode === "force_local_reprocess",
      }, settings);
      revalidateEnrichmentViews();
      return NextResponse.json({
        ...result,
        preflight,
        status: "queued",
        start: result.queued > 0 ? {
          endpoint: "/api/audio-features/start",
          body: { mode: config.mode, providerMode: config.mode, force: config.mode === "force_local_reprocess" },
        } : null,
      });
    }

    if (preflight.enrichmentType === "bpm") {
      await queueBpmRetry(userId, preflight, libraryId);
      revalidateEnrichmentViews();
      return NextResponse.json({
        ...preflight,
        status: "queued",
        message: preflight.summary,
        start: preflight.queued > 0 ? {
          endpoint: "/api/sync/start",
          body: {
            engine: "bpm",
            libraryId,
            filter: preflight.filter,
            trackIds: preflight.trackIds || [],
            providerMode: preflight.mode || "configured",
            force: preflight.mode === "force_local",
            retry: true,
          },
        } : null,
      });
    }

    await queueMetadataRetry(userId, preflight, libraryId);
    revalidateEnrichmentViews();
    return NextResponse.json({
      ...preflight,
      status: "queued",
      message: preflight.summary,
      start: preflight.queued > 0 ? {
        endpoint: "/api/sync/start",
        body: {
          engine: preflight.enrichmentType === "genres" ? "tags" : "popularity",
          retry: true,
        },
      } : null,
    });
  } catch (error) {
    console.error("[DataEnrichment] Failed to run action", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to run enrichment action" }, { status: 500 });
  }
}
