import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
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
    const settingsOverrides = {
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
        const { runAudioFeatures } = await import("@/lib/audioFeatureOrchestrator");
        const result = await runAudioFeatures({
          source: providerMode === "configured" ? "manual" : "retry",
          userId,
          settingsOverrides,
        });
        revalidatePath("/");
        revalidatePath("/data-enrichment");
        revalidatePath("/library-health");
        revalidatePath("/settings/library-health");
        return { ...result, metadata: { ...result.metadata, providerMode, force } };
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
