import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { resetPlaylistIdentity } from "@/lib/playlistIdentity";

const schema = z.object({ scope: z.enum(["LEARNED", "REJECTIONS", "HISTORY", "MANUAL", "DISABLE", "DELETE"]), confirm: z.literal(true) });
export async function POST(request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const input = schema.parse(await request.json());
    return NextResponse.json(await resetPlaylistIdentity(userId, params.playlistId, input.scope));
  } catch (error: any) {
    return NextResponse.json({ error: error?.issues?.[0]?.message || error?.message || "Unable to reset playlist identity" }, { status: error?.issues ? 400 : 500 });
  }
}
