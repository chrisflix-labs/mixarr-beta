import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { regenerateGeneratedPlaylistFromPreview } from "@/lib/playlistService";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const trackIds = Array.isArray(body.trackIds) ? body.trackIds : [];
    if (trackIds.length === 0) {
      return NextResponse.json({ error: "Regeneration preview must include at least one track" }, { status: 400 });
    }

    const result = await regenerateGeneratedPlaylistFromPreview({
      userId,
      generatedPlaylistId: params.id,
      trackIds,
      previewId: body.previewId || null,
      mode: body.mode || "replace_all",
      warnings: Array.isArray(body.warnings) ? body.warnings : [],
    });

    return NextResponse.json(result);
  } catch (error: any) {
    const message = error.message || "Failed to regenerate playlist";
    const status = message.includes("not found") || message.includes("could not find") ? 404 : message.includes("coming later") || message.includes("must include") || message.includes("manually excluded") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
