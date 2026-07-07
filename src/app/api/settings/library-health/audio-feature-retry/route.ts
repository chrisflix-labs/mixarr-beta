import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAudioFeatureRetry } from "@/lib/audioFeatureRetry";
import { isAudioFeatureHealthFilter } from "@/lib/libraryHealth";
import { getUserSyncSettings, resolveMetadataProviderSettings } from "@/lib/syncSettings";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  trackIds: z.array(z.string().uuid()).max(10_000).optional(),
  filter: z.string().optional(),
  libraryId: z.string().uuid().optional(),
  force: z.boolean().default(false),
  mode: z.string().optional(),
  providerMode: z.string().default("configured"),
}).refine((body) => (body.trackIds?.length || 0) > 0 || !!body.filter, {
  message: "Provide trackIds or a filter",
});

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid retry request" }, { status: 400 });
    }
    const { trackIds, filter, libraryId, force, mode, providerMode } = parsed.data;
    if (!trackIds?.length && !isAudioFeatureHealthFilter(filter)) {
      return NextResponse.json({ error: "A valid audio-feature health filter is required" }, { status: 400 });
    }

    const syncSettings = resolveMetadataProviderSettings(await getUserSyncSettings(userId)).audioFeatures;
    const result = await runAudioFeatureRetry(userId, {
      trackIds,
      filter,
      libraryId,
      force,
      mode: mode || providerMode,
      providerMode,
    }, syncSettings);

    revalidatePath("/");
    revalidatePath("/data-enrichment");
    revalidatePath("/library-health");
    revalidatePath("/settings/library-health");
    return NextResponse.json({
      ...result,
      retryType: "audio-feature",
      before: result.matched,
      skippedAlreadyFixed: result.skipped,
    });
  } catch (error) {
    console.error("[LibraryHealth] Failed to queue audio-feature retry", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to queue audio-feature retry" }, { status: 500 });
  }
}
