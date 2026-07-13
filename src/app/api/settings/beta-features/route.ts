import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { betaFeatureFlagDefinitions, getUnknownBetaFlagNames } from "@/lib/betaFeatures";
import { betaApiError } from "@/lib/betaApi";
import { getBetaStatus, saveUserBetaPreferences } from "@/lib/featureFlagService";

function legacyPayload(status: Awaited<ReturnType<typeof getBetaStatus>>) {
  const visibleStates = status.features.filter((state) => state.available || (status.isAdmin && state.reason === "emergency_disabled"));
  return {
    enableExperimentalFeatures: status.enabled,
    enableBetaFeatures: status.enabled,
    accessLevel: status.accessLevel,
    serverAccessLevel: status.serverAccessLevel,
    isAdmin: status.isAdmin,
    warningAcceptedAt: status.warningAcceptedAt,
    flags: Object.fromEntries(visibleStates.map((state) => [state.key, state.enabled])),
    availableFlags: betaFeatureFlagDefinitions.filter((definition) => visibleStates.some((state) => state.key === definition.key)),
    featureStates: visibleStates,
  };
}

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  return NextResponse.json(legacyPayload(await getBetaStatus({ userId })));
}

export async function PUT(req: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    const body = await req.json();
    const unknownFlags = getUnknownBetaFlagNames(body);
    if (unknownFlags.length > 0) return NextResponse.json({ error: `Unknown beta feature flag: ${unknownFlags[0]}` }, { status: 400 });
    await saveUserBetaPreferences(userId, body);
    return NextResponse.json(legacyPayload(await getBetaStatus({ userId })));
  } catch (error) { return betaApiError(error); }
}
