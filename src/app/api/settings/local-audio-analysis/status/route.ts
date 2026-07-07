import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { assertEssentiaAvailable } from "@/lib/localBpmEngine";
import { getUserSyncSettings, metadataProviderModeKey, resolveMetadataProviderSettings } from "@/lib/syncSettings";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = resolveMetadataProviderSettings(await getUserSyncSettings(userId)).audioFeatures;
  let analyzerAvailable = false;
  let analyzerError: string | null = null;

  try {
    await assertEssentiaAvailable();
    analyzerAvailable = true;
  } catch (error) {
    analyzerError = error instanceof Error ? error.message : String(error);
  }

  return NextResponse.json({
    analyzer: "Essentia",
    analyzerAvailable,
    analyzerError,
    localEnabled: settings.local,
    apiEnabled: settings.api,
    preferLocal: settings.preferLocal,
    reprocessApiWithLocal: settings.reprocessApiWithLocal,
    scope: settings.scope,
    scopeLabel: settings.scope === "whole_track" ? "Whole track" : "Sample window",
    providerMode: metadataProviderModeKey(settings as any),
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
