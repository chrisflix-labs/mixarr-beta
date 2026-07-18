import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { approveSmartAction, SmartActionError } from "@/lib/smartActions";
export async function POST(_: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value; if (!userId) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  try { return NextResponse.json(await approveSmartAction(userId, params.id)); } catch (error) { const known = error instanceof SmartActionError; return NextResponse.json({ error: error instanceof Error ? error.message : "Approval failed", code: known ? error.code : "APPROVAL_FAILED" }, { status: known ? error.status : 500 }); }
}

