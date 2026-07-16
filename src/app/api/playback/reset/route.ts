import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { resetPlaybackProfile } from "@/lib/playbackAwareness";

const schema = z.object({ confirm: z.literal("RESET PLAYBACK PROFILE") });

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    schema.parse(await request.json());
    return NextResponse.json(await resetPlaybackProfile(userId));
  } catch (error: any) {
    return NextResponse.json({ error: error?.issues?.[0]?.message || error?.message || "Could not reset playback profile" }, { status: error?.issues ? 400 : 500 });
  }
}
