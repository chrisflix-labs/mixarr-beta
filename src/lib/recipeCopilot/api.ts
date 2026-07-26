import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AiError } from "@/ai/errors";
import { describeRequestLimitFromDetails } from "@/ai/governance/requestLimits";
import { describeCostLimitFromDetails } from "@/ai/governance/costLimits";

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
      : error.category === "MONTHLY_REQUEST_LIMIT_REACHED" ? "AI_MONTHLY_REQUEST_LIMIT_EXCEEDED"
      : ["DAILY_REQUEST_LIMIT_REACHED", "AI_DAILY_REQUEST_LIMIT_EXCEEDED", "DAILY_COST_LIMIT_REACHED"].includes(error.category) ? "AI_DAILY_LIMIT_EXCEEDED"
      : ["AUTHENTICATION_FAILED", "PROVIDER_UNAUTHORIZED"].includes(error.category) ? "AI_PROVIDER_AUTH_FAILED"
      : ["RATE_LIMITED", "PROVIDER_RATE_LIMITED"].includes(error.category) ? "AI_PROVIDER_RATE_LIMITED"
      : ["REQUEST_TIMEOUT", "PROVIDER_TIMEOUT", "AI_PROVIDER_TIMEOUT"].includes(error.category) ? "AI_PROVIDER_TIMEOUT"
      : ["CONNECTION_FAILED", "PROVIDER_OVERLOADED", "PROVIDER_SERVICE_ERROR", "STREAM_INTERRUPTED"].includes(error.category) ? "AI_PROVIDER_TEMPORARY_FAILURE"
      : error.category;
    const details = error.details || {};
    const provider = typeof details.provider === "string" ? details.provider : undefined;
    const model = typeof details.model === "string" ? details.model : undefined;
    const requestId = typeof details.request_id === "string" ? details.request_id : typeof details.correlation_id === "string" ? details.correlation_id : undefined;
    const elapsedMs = typeof details.elapsed_ms === "number" ? details.elapsed_ms : undefined;
    const stage = typeof details.stage === "string" ? details.stage : typeof details.failure_stage === "string" ? details.failure_stage : undefined;
    const timeoutSeconds = typeof details.timeout_ms === "number" ? Math.round(details.timeout_ms / 1000) : undefined;
    const message =
      mappedCode === "AI_PROVIDER_UNAVAILABLE" ? "No enabled AI provider is available."
      : mappedCode === "AI_MODEL_UNAVAILABLE" ? "No usable AI model is configured for Recipe Copilot."
      : mappedCode === "AI_MODEL_PRICING_UNAVAILABLE" ? "Pricing is unavailable for the selected AI model."
      : mappedCode === "AI_MONTHLY_BUDGET_EXCEEDED" ? "The configured AI monthly budget has been reached."
      : mappedCode === "AI_RETRY_COST_LIMIT_EXCEEDED" ? "The first attempt failed temporarily, but another attempt would exceed the AI retry cost limit."
      : mappedCode === "AI_PROVIDER_TIMEOUT" ? `${provider || "The AI provider"} did not respond before the ${timeoutSeconds || 120}-second timeout.`
      : mappedCode === "AI_PROVIDER_EMPTY_RESPONSE" ? `${provider || "The AI provider"} returned no usable assistant content.`
      : mappedCode === "AI_PROVIDER_UNSUPPORTED_RESPONSE_SHAPE" ? `${provider || "The AI provider"} returned an unsupported response shape.`
      : mappedCode === "AI_PROVIDER_MALFORMED_JSON" ? `${provider || "The AI provider"} returned malformed JSON.`
      : mappedCode === "AI_PROVIDER_REFUSAL" ? `${provider || "The AI provider"} refused the request.`
      : mappedCode === "AI_PROVIDER_TOOL_CALL_ONLY" ? `${provider || "The AI provider"} returned a tool call without a final answer.`
      : mappedCode === "AI_PROVIDER_TRUNCATED_BEFORE_FINAL" ? `${provider || "The AI provider"} stopped before producing a final answer.`
      : mappedCode === "AI_PROVIDER_TRUNCATED_FINAL_RESPONSE" ? `${provider || "The AI provider"} stopped while producing the final answer.`
      : mappedCode === "AI_PROVIDER_TRUNCATED_RESPONSE" ? `${provider || "The AI provider"} stopped before returning a complete final answer.`
      : mappedCode === "AI_PROVIDER_INVALID_STRUCTURED_RESPONSE" ? `${provider || "The AI provider"} completed normally, but returned invalid structured output.`
      : mappedCode === "AI_PROVIDER_HTTP_ERROR" ? `${provider || "The AI provider"} returned an HTTP error${typeof details.http_status === "number" ? ` (${details.http_status})` : ""}.`
      : mappedCode === "AI_FEATURE_INVALID_JSON_OUTPUT" ? "The AI provider returned text instead of JSON."
      : mappedCode === "AI_FEATURE_INVALID_STRUCTURED_OUTPUT" ? "The AI provider responded successfully, but the draft did not match the Recipe Copilot format."
      : mappedCode === "AI_FEATURE_TRUNCATED_STRUCTURED_OUTPUT" ? "The provider stopped before returning a complete Recipe Copilot draft."
      : mappedCode === "AI_FEATURE_EMPTY_OUTPUT" ? "The provider returned no final Recipe Copilot content."
      : mappedCode === "AI_FEATURE_STRUCTURED_REPAIR_FAILED" ? "The provider draft was incompatible and an automatic format repair did not succeed."
      : ["AI_PROVIDER_INVALID_RESPONSE", "AI_RECIPE_SCHEMA_INVALID"].includes(mappedCode) ? `${provider || "The AI provider"} returned content that did not match the Recipe Copilot schema.`
      : ["AI_DAILY_LIMIT_EXCEEDED", "AI_MONTHLY_REQUEST_LIMIT_EXCEEDED"].includes(mappedCode) ? describeRequestLimitFromDetails(error.details) || error.toSafePayload().error.message
      : mappedCode === "AI_REQUEST_COST_LIMIT_EXCEEDED" ? describeCostLimitFromDetails(error.details) || error.toSafePayload().error.message
      : error.toSafePayload().error.message;
    const retryable = details.retryable === true || ["AI_PROVIDER_TIMEOUT", "AI_PROVIDER_TEMPORARY_FAILURE", "AI_PROVIDER_RATE_LIMITED"].includes(mappedCode);
    const sanitizedDiagnostics = {
      jsonParsed: details.json_parsed === true,
      normalized: details.normalized === true,
      repairAttempted: details.repair_attempted === true,
      issues: Array.isArray(details.issues) ? details.issues.slice(0, 10).map((issue: any) => ({ path: String(issue?.path || ""), code: String(issue?.code || "invalid"), expected: issue?.expected, receivedType: issue?.receivedType })) : [],
    };
    const envelope = { code: mappedCode, message, requestId: requestId || null, retryable, provider: provider || null, model: model || null, stage: stage || "AI_ORCHESTRATION", elapsedMs: elapsedMs ?? 0, diagnostics: sanitizedDiagnostics };
    return NextResponse.json({ error: { ...envelope, ...(mappedCode !== error.category ? { legacyCode: error.category } : {}), ...(error.details ? { details: error.details } : {}) }, ...envelope }, { status: error.status });
  }
  if (error instanceof ZodError) { const envelope = { code: "INVALID_REQUEST", message: error.issues[0]?.message || "Invalid Recipe Copilot request.", requestId: null, retryable: false, provider: null, model: null, stage: "REQUEST_VALIDATION", elapsedMs: 0 }; return NextResponse.json({ error: { ...envelope, fields: error.flatten() }, ...envelope }, { status: 400 }); }
  const value = error as any; const status = Number(value?.status) || 500; const code = String(value?.code || value?.category || "AI_RECIPE_REQUEST_FAILED");
  if (status >= 500) console.error("[RecipeCopilot] API failure", { code });
  const requestId = typeof value?.requestId === "string" ? value.requestId : undefined;
  const message = error instanceof Error ? error.message : "Recipe Copilot request failed.";
  const envelope = { code, message, requestId: requestId || null, retryable: false, provider: null, model: null, stage: "API_ROUTE", elapsedMs: 0 };
  return NextResponse.json({ error: envelope, ...envelope }, { status });
}
