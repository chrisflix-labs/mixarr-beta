import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { previewGeneratedPlaylistRegeneration } from "@/lib/playlistService";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const mode = body.mode || "replace_all";
    if (mode !== "replace_all") {
      return NextResponse.json({ error: "Keep some existing tracks is coming later. Preview with Replace all tracks for v1.2.3." }, { status: 400 });
    }

    const result = await previewGeneratedPlaylistRegeneration({
      userId,
      generatedPlaylistId: params.id,
      preferDifferentTracks: Boolean(body.preferDifferentTracks),
    });

    return NextResponse.json(result);
  } catch (error: any) {
    const message = error.message || "Failed to preview regeneration";
    const status = message.includes("not found") ? 404 : message.includes("Invalid") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
