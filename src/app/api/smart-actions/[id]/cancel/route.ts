import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { cancelSmartAction, SmartActionError } from "@/lib/smartActions";
export async function POST(_: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value; if (!userId) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  try { return NextResponse.json(await cancelSmartAction(userId, params.id)); } catch (error) { const known = error instanceof SmartActionError; return NextResponse.json({ error: error instanceof Error ? error.message : "Cancellation failed", code: known ? error.code : "CANCEL_FAILED" }, { status: known ? error.status : 500 }); }
}

