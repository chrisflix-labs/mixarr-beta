import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getBetaStatus } from "@/lib/featureFlagService";

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const status = await getBetaStatus({ userId });
  return NextResponse.json({ features: status.features.filter((state) => state.available || (status.isAdmin && state.reason === "emergency_disabled")) });
}
