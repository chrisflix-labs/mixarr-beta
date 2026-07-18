import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { executeSmartRefreshEvaluation } from "@/lib/smartRefresh";

const schema = z.object({ evaluationId: z.string().uuid(), acceptedPositions: z.array(z.coerce.number().int().min(1).max(10000)).max(5000).optional() }).strict();
export const maxDuration = 120;
export async function POST(request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value; if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { const value = schema.parse(await request.json()); return NextResponse.json(await executeSmartRefreshEvaluation({ userId, generatedPlaylistId: params.playlistId, ...value })); }
  catch (error: any) { return NextResponse.json({ error: error?.issues?.[0]?.message || error?.message || "Smart Refresh execution failed" }, { status: 409 }); }
}
