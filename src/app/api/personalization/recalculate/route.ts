import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getPersonalizationProfileSummary, recalculatePersonalizationProfile } from "@/lib/personalization";

export async function POST() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await recalculatePersonalizationProfile(userId, "manual");
    return NextResponse.json({ result, summary: await getPersonalizationProfileSummary(userId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Profile rebuild failed" }, { status: 500 });
  }
}

