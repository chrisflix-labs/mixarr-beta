import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { preflightAudioFeatureRetry } from "@/lib/audioFeatureRetry";
import { getUserSyncSettings, resolveMetadataProviderSettings } from "@/lib/syncSettings";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  filter: z.string().optional(),
  mode: z.string().optional(),
  providerMode: z.string().optional(),
  trackIds: z.array(z.string().uuid()).max(10_000).optional(),
  libraryId: z.string().uuid().optional(),
  force: z.boolean().optional(),
}).refine((body) => !!body.filter || (body.trackIds?.length || 0) > 0, {
  message: "Provide an audio-feature filter or selected tracks",
});

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid retry preflight request" }, { status: 400 });
    }
    const syncSettings = resolveMetadataProviderSettings(await getUserSyncSettings(userId)).audioFeatures;
    const result = await preflightAudioFeatureRetry(userId, parsed.data, syncSettings);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[LibraryHealth] Failed to preflight audio-feature retry", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to preflight audio-feature retry" }, { status: 500 });
  }
}
