import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { clonePlaylistIdentity } from "@/lib/playlistIdentity";

const schema = z.object({ name: z.string().trim().min(1).max(120), includeImportantTracks: z.boolean().default(false), includeLockedTracks: z.boolean().default(false), includeRejections: z.boolean().default(false) });
export async function POST(request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const input = schema.parse(await request.json());
    return NextResponse.json(await clonePlaylistIdentity({ userId, playlistId: params.playlistId, ...input }));
  } catch (error: any) {
    const message = error?.issues?.[0]?.message || error?.message || "Unable to clone playlist identity";
    return NextResponse.json({ error: message }, { status: error?.issues ? 400 : message.includes("not found") ? 404 : 500 });
  }
}
