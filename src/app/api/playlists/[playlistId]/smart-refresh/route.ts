import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSmartRefreshLatest, getSmartRefreshSettings, updateSmartRefreshSettings } from "@/lib/smartRefresh";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value; if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { const [configuration, latestEvaluation] = await Promise.all([getSmartRefreshSettings(userId, params.playlistId), getSmartRefreshLatest(userId, params.playlistId)]); return NextResponse.json({ ...configuration, latestEvaluation }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { const message = error instanceof Error ? error.message : "Unable to load Smart Refresh settings"; return NextResponse.json({ error: message }, { status: /not found/i.test(message) ? 404 : 500 }); }
}

export async function PATCH(request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value; if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await updateSmartRefreshSettings(userId, params.playlistId, await request.json())); }
  catch (error: any) { return NextResponse.json({ error: error?.issues?.[0]?.message || error?.message || "Unable to update Smart Refresh settings" }, { status: 400 }); }
}
