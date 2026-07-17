import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { setPlaylistProtection } from "@/lib/automation";

const schema = z.object({ protected: z.boolean(), reason: z.string().trim().max(500).nullable().optional() });
export async function PUT(request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const settings = await setPlaylistProtection(userId, params.playlistId, parsed.data.protected, parsed.data.reason);
  return settings ? NextResponse.json({ settings }) : NextResponse.json({ error: "Playlist not found." }, { status: 404 });
}
