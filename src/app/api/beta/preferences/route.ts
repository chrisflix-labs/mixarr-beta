import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { betaApiError } from "@/lib/betaApi";
import { getBetaStatus, saveUserBetaPreferences } from "@/lib/featureFlagService";

export async function PUT(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    await saveUserBetaPreferences(userId, await request.json());
    return NextResponse.json(await getBetaStatus({ userId }));
  } catch (error) { return betaApiError(error); }
}
