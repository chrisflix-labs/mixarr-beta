import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAdaptiveScoringSettings, recalculateAdaptiveScoringProfile } from "@/lib/adaptiveScoring";

export async function POST() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await recalculateAdaptiveScoringProfile(userId, "manual");
    return NextResponse.json({ result, ...(await getAdaptiveScoringSettings(userId)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Adaptive scoring recalculation failed" }, { status: 500 });
  }
}
