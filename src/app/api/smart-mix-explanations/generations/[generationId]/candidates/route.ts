import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { listGenerationCandidates } from "@/lib/smartMixExplanations/service";

export async function GET(req: Request, { params }: { params: { generationId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const query = new URL(req.url).searchParams;
  const result = await listGenerationCandidates(userId, params.generationId, { decision: query.get("decision") || undefined, rejectionCode: query.get("rejectionCode") || undefined, factorCode: query.get("factorCode") || undefined, page: Number(query.get("page") || 1), pageSize: Number(query.get("pageSize") || 25) });
  return NextResponse.json(result);
}
