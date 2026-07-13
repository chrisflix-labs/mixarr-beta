import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { comparePlaylistVersions } from "@/lib/playlists/versions/playlist-version-service";

const schema = z.object({ fromVersionId: z.string().uuid(), toVersionId: z.string().uuid() }).refine((data) => data.fromVersionId !== data.toVersionId, { message: "Choose two different versions" });

export async function POST(request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid comparison" }, { status: 400 });
  try {
    return NextResponse.json(await comparePlaylistVersions(userId, params.playlistId, parsed.data.fromVersionId, parsed.data.toVersionId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Comparison failed" }, { status: 400 });
  }
}

