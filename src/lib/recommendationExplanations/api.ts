import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function recommendationExplanationUserId() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) throw Object.assign(new Error("Authentication is required."), { code: "UNAUTHORIZED", status: 401 });
  return userId;
}

export function recommendationExplanationApiError(error: unknown) {
  if (error instanceof ZodError) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: error.issues[0]?.message || "Invalid recommendation explanation request.", fields: error.flatten() } }, { status: 400 });
  const value = error as any;
  const status = Number(value?.status) || 500;
  const code = String(value?.code || "RECOMMENDATION_EXPLANATION_FAILED");
  if (status >= 500) console.error("[RecommendationExplanation] API failure", { code });
  return NextResponse.json({ error: { code, message: error instanceof Error ? error.message : "Recommendation explanation request failed." } }, { status });
}
