import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { invalidateLibraryHealthCache } from "@/lib/libraryHealth";
import { getUserSyncSettings } from "@/lib/syncSettings";
import { alreadyRunningPayload, startSyncJobInBackground } from "@/lib/syncJobRunner";

export async function POST(request: Request) {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const providerMode = typeof body?.providerMode === "string" ? body.providerMode : typeof body?.mode === "string" ? body.mode : "configured";
    const force = body?.force === true || providerMode === "force_local" || providerMode === "force_local_reprocess";
    const baseSettings = await getUserSyncSettings(userId);
    const syncSettings = {
      ...baseSettings,
      ...(providerMode === "api_only" ? { enableApiAudioFeatures: true, enableLocalAudioFeatures: false } : {}),
      ...(providerMode === "local_only" || force ? {
        enableApiAudioFeatures: false,
        enableLocalAudioFeatures: true,
        preferLocalAudioFeatures: true,
        reprocessApiAudioFeaturesWithLocal: force,
        reprocessLocalAudioFeatures: force,
      } : {}),
    };
    const started = startSyncJobInBackground({
      engine: "audio",
      userId,
      trackedEngine: "audio",
      source: providerMode === "configured" ? "manual" : "retry",
      task: async () => {
        const audio = await import("@/lib/audioFeatureEngine");
        const apiSummary = await audio.runAudioFeatureEngine(syncSettings);
        const local = await import("@/lib/localAudioFeatureEngine");
        const localSummary = await local.runLocalAudioFeatureEngine(syncSettings);
        await invalidateLibraryHealthCache(userId, { reason: "audio_feature_sync_completed" });
        revalidatePath("/");
        revalidatePath("/library-health");
        revalidatePath("/settings/library-health");
        return {
          attempted: apiSummary.attempted + localSummary.attempted,
          processed: apiSummary.processed + localSummary.processed,
          skipped: apiSummary.skipped + localSummary.skipped,
          failed: apiSummary.failed + localSummary.failed,
          metadata: {
            providerMode,
            force,
            api: apiSummary,
            local: localSummary,
          },
        };
      },
    });

    if (!started.started) {
      return NextResponse.json(alreadyRunningPayload("audio", started.activeJob));
    }

    return NextResponse.json({ status: "started", message: "Audio Feature sync job initiated" });
  } catch (error) {
    console.error("Failed to start audio feature sync", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
