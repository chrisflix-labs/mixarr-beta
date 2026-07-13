import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { bulkSetGeneratedPlaylistTrackLocks } from "@/lib/playlistService";

const schema = z.object({
  trackIds: z.array(z.string().min(1)).max(5000).optional(),
  locked: z.boolean(),
  likedOnly: z.boolean().default(false),
});

export async function POST(request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const input = schema.parse(await request.json());
    return NextResponse.json(await bulkSetGeneratedPlaylistTrackLocks({ userId, generatedPlaylistId: params.playlistId, ...input }));
  } catch (error: any) {
    const message = error?.issues?.[0]?.message || error.message || "Failed to update track locks";
    return NextResponse.json({ error: message }, { status: error?.issues ? 400 : message.includes("not found") ? 404 : 500 });
  }
}
