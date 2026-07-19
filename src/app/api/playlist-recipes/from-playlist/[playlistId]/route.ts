import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createRecipeFromPlaylist } from "@/lib/mixRecipes/service";

export async function POST(req: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    const recipe = await createRecipeFromPlaylist({ userId, playlistId: params.playlistId, metadata: body.metadata, includedSections: body.includedSections });
    return NextResponse.json({ recipe }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create recipe from playlist.";
    return NextResponse.json({ error: message }, { status: message.includes("not found") ? 404 : 400 });
  }
}

