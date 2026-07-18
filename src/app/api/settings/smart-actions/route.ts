import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSmartActionSettings, updateSmartActionAutomationPolicy, updateSmartActionSettings, SmartActionError } from "@/lib/smartActions";
export const dynamic = "force-dynamic";
export async function GET() { const userId = cookies().get("mixarr_session")?.value; return userId ? NextResponse.json(await getSmartActionSettings(userId), { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 }); }
export async function PATCH(request: Request) {
  const userId = cookies().get("mixarr_session")?.value; if (!userId) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  try { const body = await request.json(); return NextResponse.json(body.policy ? await updateSmartActionAutomationPolicy(userId, body.policy) : await updateSmartActionSettings(userId, body)); }
  catch (error) { const known = error instanceof SmartActionError; return NextResponse.json({ error: (error as any)?.issues?.[0]?.message || (error instanceof Error ? error.message : "Settings update failed"), code: known ? error.code : "INVALID_INPUT" }, { status: known ? error.status : 400 }); }
}

