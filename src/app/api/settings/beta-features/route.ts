import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  betaFeatureFlagDefinitions,
  getBetaFeatureSettings,
  getUnknownBetaFlagNames,
  saveBetaFeatureSettings,
} from "@/lib/betaFeatures";

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await getBetaFeatureSettings();
  return NextResponse.json({
    ...settings,
    availableFlags: betaFeatureFlagDefinitions,
  });
}

export async function PUT(req: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const unknownFlags = getUnknownBetaFlagNames(body);
    if (unknownFlags.length > 0) {
      return NextResponse.json(
        { error: `Unknown beta feature flag: ${unknownFlags[0]}` },
        { status: 400 },
      );
    }

    const settings = await saveBetaFeatureSettings(body);
    return NextResponse.json({
      ...settings,
      availableFlags: betaFeatureFlagDefinitions,
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to save beta feature settings." },
      { status: 500 },
    );
  }
}
