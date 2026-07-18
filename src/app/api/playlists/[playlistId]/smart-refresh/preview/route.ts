import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSmartRefreshPreview } from "@/lib/smartRefresh";

export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value; if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const evaluationId = new URL(request.url).searchParams.get("evaluationId"); if (!evaluationId) return NextResponse.json({ error: "evaluationId is required" }, { status: 400 });
  try { return NextResponse.json(await getSmartRefreshPreview(userId, params.playlistId, evaluationId)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load Smart Refresh preview" }, { status: 404 }); }
}
