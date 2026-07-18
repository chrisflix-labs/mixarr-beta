import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { snoozeSmartAction, SmartActionError } from "@/lib/smartActions";
const schema = z.object({ preset: z.enum(["ONE_DAY", "THREE_DAYS", "ONE_WEEK", "ONE_MONTH"]).optional(), until: z.string().datetime().optional(), condition: z.enum(["PLAYLIST_CHANGES", "NEW_TRACKS_ANALYZED"]).optional() }).strict();
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value; if (!userId) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => ({}))); if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message, code: "INVALID_INPUT" }, { status: 400 });
  try { return NextResponse.json(await snoozeSmartAction(userId, params.id, parsed.data)); } catch (error) { const known = error instanceof SmartActionError; return NextResponse.json({ error: error instanceof Error ? error.message : "Snooze failed", code: known ? error.code : "SNOOZE_FAILED" }, { status: known ? error.status : 500 }); }
}

