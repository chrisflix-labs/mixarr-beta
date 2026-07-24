import { NextResponse } from "next/server";
import { aiRouteError, requireAiPermission } from "@/ai/services/api";
import { getEffectiveAuthorization } from "@/ai/governance/executionPolicy";

export const dynamic = "force-dynamic";

// Administrator-safe effective authorization diagnostics for a provider+feature.
// GET /api/ai/effective-policy?providerId=...&feature=recipe_copilot[&model=...]
export async function GET(request: Request) {
  try {
    await requireAiPermission("VIEW_SANITIZED_AI_DETAILS");
    const url = new URL(request.url);
    const providerId = url.searchParams.get("providerId");
    const feature = url.searchParams.get("feature") || "recipe_copilot";
    if (!providerId) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "providerId is required." }, code: "INVALID_REQUEST", message: "providerId is required." }, { status: 400 });
    const model = url.searchParams.get("model") || undefined;
    const privacyMode = url.searchParams.get("privacyMode") || undefined;
    const externalConfirmation = url.searchParams.get("externalConfirmation") === "true";
    return NextResponse.json(await getEffectiveAuthorization({ providerId, feature, model, privacyMode, externalConfirmation }));
  } catch (error) {
    return aiRouteError(error);
  }
}
