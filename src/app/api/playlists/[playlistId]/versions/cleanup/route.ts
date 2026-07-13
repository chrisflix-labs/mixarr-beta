import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { runPlaylistVersionCleanup } from "@/lib/playlists/versions/playlist-version-service";

const schema = z.object({ keep: z.number().int().min(1).max(500).default(25) });

export async function POST(request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid retention limit" }, { status: 400 });
  const result = await runPlaylistVersionCleanup(userId, params.playlistId, parsed.data.keep);
  return result ? NextResponse.json(result) : NextResponse.json({ error: "Generated playlist not found" }, { status: 404 });
}

