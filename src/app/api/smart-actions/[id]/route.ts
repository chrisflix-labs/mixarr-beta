import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSmartAction } from "@/lib/smartActions";
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  const action = await getSmartAction(userId, params.id);
  return action ? NextResponse.json(action, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "Smart Action not found", code: "NOT_FOUND" }, { status: 404 });
}

