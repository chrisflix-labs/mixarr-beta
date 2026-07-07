import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { APP_VERSION } from "@/lib/appVersion";
import { getLibraryHealthDetailSummary } from "@/lib/libraryHealthDetails";
import { getUserSyncSettings, metadataProviderModeKey, resolveMetadataProviderSettings } from "@/lib/syncSettings";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const libraryId = params.get("libraryId") || undefined;

  try {
    const providerSettings = resolveMetadataProviderSettings(await getUserSyncSettings(userId));
    const summary = await getLibraryHealthDetailSummary(userId, libraryId, providerSettings.audioFeatures);
    const payload = {
      timestamp: new Date().toISOString(),
      mixarrVersion: APP_VERSION,
      libraryId: libraryId || null,
      activeTrackCount: summary.totalTracks,
      providerModeSettings: {
        bpm: metadataProviderModeKey(providerSettings.bpm as any),
        audioFeatures: metadataProviderModeKey(providerSettings.audioFeatures as any),
      },
      summaryCounts: {
        totalTracks: summary.totalTracks,
        categories: summary.categories,
      },
      invariantResults: summary.diagnostics.invariants,
      mismatchResults: summary.diagnostics.mismatches,
      categoryCounts: summary.categories,
    };

    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="mixarr-health-diagnostics-${Date.now()}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[LibraryHealth] Failed to export diagnostics", error);
    return NextResponse.json({ error: "Failed to export Library Health diagnostics" }, { status: 500 });
  }
}
