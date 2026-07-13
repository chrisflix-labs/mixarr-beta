import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { setGeneratedPlaylistTrackLock } from "@/lib/playlistService";

const schema = z.object({ locked: z.boolean() });

export async function PATCH(request: Request, { params }: { params: { playlistId: string; trackId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { locked } = schema.parse(await request.json());
    return NextResponse.json(await setGeneratedPlaylistTrackLock({ userId, generatedPlaylistId: params.playlistId, trackId: params.trackId, locked }));
  } catch (error: any) {
    const message = error?.issues?.[0]?.message || error.message || "Failed to update track lock";
    return NextResponse.json({ error: message }, { status: error?.issues ? 400 : message.includes("not found") ? 404 : 500 });
  }
}

