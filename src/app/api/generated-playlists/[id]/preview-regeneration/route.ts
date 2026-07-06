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
    const result = await previewGeneratedPlaylistRegeneration({
      userId,
      generatedPlaylistId: params.id,
      mode: body.mode || "replace_all",
      keepPercent: Number(body.keepPercent || 25),
      preferDifferentTracks: Boolean(body.preferDifferentTracks),
    });

    return NextResponse.json(result);
  } catch (error: any) {
    const message = error.message || "Failed to preview regeneration";
    const status = message.includes("not found") || message.includes("could not find")
      ? 404
      : message.includes("Invalid") || message.includes("Unsupported")
      ? 400
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
