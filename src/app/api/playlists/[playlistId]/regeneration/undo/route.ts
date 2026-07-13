import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { undoAdvancedPlaylistRegeneration } from "@/lib/playlistService";

export async function POST(_request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await undoAdvancedPlaylistRegeneration({ userId, generatedPlaylistId: params.playlistId }));
  } catch (error: any) {
    const message = error.message || "Failed to undo regeneration";
    return NextResponse.json({ error: message }, { status: message.includes("No applied") ? 409 : 500 });
  }
}

