import { NextResponse } from "next/server";
import { FeatureUnavailableError } from "./featureFlagService";

export function betaApiError(error: unknown) {
  if (error instanceof FeatureUnavailableError) {
    return NextResponse.json({ error: error.code, feature: error.featureKey, reason: error.reason.toUpperCase() }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "BETA_REQUEST_FAILED";
  if (message === "BETA_ACKNOWLEDGEMENT_REQUIRED") return NextResponse.json({ error: message }, { status: 400 });
  if (message === "ADMIN_REQUIRED") return NextResponse.json({ error: message }, { status: 403 });
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: message }, { status: 401 });
  if (message === "SCORING_MODEL_NOT_FOUND") return NextResponse.json({ error: message }, { status: 400 });
  console.error("[BetaAPI] Request failed", { error: message });
  return NextResponse.json({ error: "BETA_REQUEST_FAILED" }, { status: 500 });
}
