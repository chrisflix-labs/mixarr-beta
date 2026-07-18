import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { dismissSmartRefreshEvaluation } from "@/lib/smartRefresh";

const schema = z.object({ evaluationId: z.string().uuid() }).strict();
export async function POST(request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value; if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { const value = schema.parse(await request.json()); return NextResponse.json(await dismissSmartRefreshEvaluation(userId, params.playlistId, value.evaluationId)); }
  catch (error: any) { return NextResponse.json({ error: error?.issues?.[0]?.message || error?.message || "Unable to dismiss recommendation" }, { status: 400 }); }
}
