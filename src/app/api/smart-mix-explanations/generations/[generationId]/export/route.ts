import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { exportGenerationDebugReport } from "@/lib/smartMixExplanations/service";

export async function GET(_: Request, { params }: { params: { generationId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const report = await exportGenerationDebugReport(userId, params.generationId);
  if (!report) return NextResponse.json({ error: "Generation report not found" }, { status: 404 });
  return new NextResponse(JSON.stringify(report, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="mixarr-smart-mix-${params.generationId}.json"`, "Cache-Control": "private, no-store" } });
}
