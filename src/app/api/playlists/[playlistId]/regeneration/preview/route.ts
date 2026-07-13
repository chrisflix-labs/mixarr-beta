import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { previewAdvancedPlaylistRegeneration } from "@/lib/playlistService";

export async function POST(request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const input = await request.json();
    return NextResponse.json(await previewAdvancedPlaylistRegeneration({ userId, generatedPlaylistId: params.playlistId, input }));
  } catch (error: any) {
    const message = error instanceof ZodError ? error.issues[0]?.message : error.message || "Failed to build regeneration preview";
    return NextResponse.json({ error: message }, { status: error instanceof ZodError ? 400 : message.includes("not found") ? 404 : 500 });
  }
}

