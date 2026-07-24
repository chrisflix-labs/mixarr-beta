import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AiError } from "@/ai/errors";

export function recipeCopilotUserId() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) throw Object.assign(new Error("Authentication is required."), { code: "UNAUTHORIZED", status: 401 });
  return userId;
}

export function recipeCopilotApiError(error: unknown) {
  if (error instanceof AiError) {
    const mappedCode =
      ["PROVIDER_NOT_CONFIGURED", "PROVIDER_DISABLED", "PROVIDER_NOT_FOUND", "PROVIDER_UNAVAILABLE"].includes(error.category) ? "AI_PROVIDER_UNAVAILABLE"
      : ["MODEL_NOT_CONFIGURED", "MODEL_NOT_FOUND", "MODEL_NOT_AVAILABLE", "AI_MODEL_DISABLED", "AI_MODEL_NOT_APPROVED", "AI_MODEL_FEATURE_BLOCKED"].includes(error.category) ? "AI_MODEL_UNAVAILABLE"
      : ["MODEL_UNPRICED", "AI_MODEL_PRICING_MISSING"].includes(error.category) ? "AI_MODEL_PRICING_UNAVAILABLE"
      : ["AI_GLOBAL_BUDGET_EXCEEDED", "MONTHLY_COST_LIMIT_REACHED"].includes(error.category) ? "AI_MONTHLY_BUDGET_EXCEEDED"
      : ["DAILY_REQUEST_LIMIT_REACHED", "AI_DAILY_REQUEST_LIMIT_EXCEEDED", "DAILY_COST_LIMIT_REACHED"].includes(error.category) ? "AI_DAILY_LIMIT_EXCEEDED"
      : ["AUTHENTICATION_FAILED", "PROVIDER_UNAUTHORIZED"].includes(error.category) ? "AI_PROVIDER_AUTH_FAILED"
      : ["RATE_LIMITED", "PROVIDER_RATE_LIMITED"].includes(error.category) ? "AI_PROVIDER_RATE_LIMITED"
      : ["REQUEST_TIMEOUT", "CONNECTION_FAILED", "PROVIDER_OVERLOADED", "PROVIDER_SERVICE_ERROR", "STREAM_INTERRUPTED"].includes(error.category) ? "AI_PROVIDER_TEMPORARY_FAILURE"
      : error.category;
    const message =
      mappedCode === "AI_PROVIDER_UNAVAILABLE" ? "No enabled AI provider is available."
      : mappedCode === "AI_MODEL_UNAVAILABLE" ? "No usable AI model is configured for Recipe Copilot."
      : mappedCode === "AI_MODEL_PRICING_UNAVAILABLE" ? "Pricing is unavailable for the selected AI model."
      : mappedCode === "AI_MONTHLY_BUDGET_EXCEEDED" ? "The configured AI monthly budget has been reached."
      : mappedCode === "AI_RETRY_COST_LIMIT_EXCEEDED" ? "The first attempt failed temporarily, but another attempt would exceed the AI retry cost limit."
      : error.toSafePayload().error.message;
    return NextResponse.json({ error: { code: mappedCode, message, ...(mappedCode !== error.category ? { legacyCode: error.category } : {}), ...(error.details ? { details: error.details } : {}) }, code: mappedCode, message }, { status: error.status });
  }
  if (error instanceof ZodError) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: error.issues[0]?.message || "Invalid Recipe Copilot request.", fields: error.flatten() } }, { status: 400 });
  const value = error as any; const status = Number(value?.status) || 500; const code = String(value?.code || value?.category || "AI_RECIPE_REQUEST_FAILED");
  if (status >= 500) console.error("[RecipeCopilot] API failure", { code });
  return NextResponse.json({ error: { code, message: error instanceof Error ? error.message : "Recipe Copilot request failed." } }, { status });
}
