import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getJobFailureReport } from "@/lib/support";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { jobId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const report = await getJobFailureReport(userId, params.jobId);
    if (!report) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    return new NextResponse(report, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[Support] Failed to generate job report", error);
    return NextResponse.json({ error: "Unable to generate diagnostics. Check logs or try again." }, { status: 500 });
  }
}
