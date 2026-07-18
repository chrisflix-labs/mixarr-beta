import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ensureSmartRefreshGlobalSettings, updateSmartRefreshGlobalSettings } from "@/lib/smartRefresh";

export const dynamic = "force-dynamic";
export async function GET() { const userId = cookies().get("mixarr_session")?.value; if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); return NextResponse.json(await ensureSmartRefreshGlobalSettings(userId), { headers: { "Cache-Control": "no-store" } }); }
export async function PATCH(request: Request) { const userId = cookies().get("mixarr_session")?.value; if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); try { return NextResponse.json(await updateSmartRefreshGlobalSettings(userId, await request.json())); } catch (error: any) { return NextResponse.json({ error: error?.issues?.[0]?.message || error?.message || "Unable to save Smart Refresh defaults" }, { status: 400 }); } }
