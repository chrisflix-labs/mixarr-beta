import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSmartActionSummary } from "@/lib/smartActions";
export const dynamic = "force-dynamic";
export async function GET() { const userId = cookies().get("mixarr_session")?.value; return userId ? NextResponse.json(await getSmartActionSummary(userId), { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 }); }

