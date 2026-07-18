import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { rejectSmartAction, SmartActionError } from "@/lib/smartActions";
const schema = z.object({ reason: z.string().max(500).optional() }).strict();
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value; if (!userId) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => ({}))); if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message, code: "INVALID_INPUT" }, { status: 400 });
  try { return NextResponse.json(await rejectSmartAction(userId, params.id, parsed.data.reason)); } catch (error) { const known = error instanceof SmartActionError; return NextResponse.json({ error: error instanceof Error ? error.message : "Rejection failed", code: known ? error.code : "REJECTION_FAILED" }, { status: known ? error.status : 500 }); }
}

