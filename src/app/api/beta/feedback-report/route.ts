import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { betaApiError } from "@/lib/betaApi";
import { saveBetaFeedbackReport } from "@/lib/betaDiagnostics";

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    const body = await request.json();
    return NextResponse.json(await saveBetaFeedbackReport(userId, { userId, featureKey: body.featureKey, playlistId: body.playlistId, scoringModel: body.scoringModel, action: body.action, fallbackUsed: body.fallbackUsed, warnings: body.warnings, errors: body.errors, jobId: body.jobId, scoreSummary: body.scoreSummary, generationSettings: body.generationSettings }));
  } catch (error) { return betaApiError(error); }
}
