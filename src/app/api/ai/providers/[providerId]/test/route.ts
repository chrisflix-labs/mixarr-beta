import { NextResponse } from "next/server";
import { aiRouteError, requireAiAdmin } from "@/ai/services/api";
import { testAiProviderConnection } from "@/ai/health/service";
import { previewAiRequest } from "@/ai/governance/service";
import { resolveAiProvider } from "@/ai/services/providerService";
import { AiError } from "@/ai/errors";

export const dynamic = "force-dynamic";
const governanceCodes = new Set(["AI_DISABLED", "USER_NOT_AUTHORIZED", "PAID_PROVIDER_NOT_PERMITTED", "BACKGROUND_REQUEST_NOT_PERMITTED", "MODEL_UNPRICED", "PRIVACY_MODE_INCOMPATIBLE", "DAILY_REQUEST_LIMIT_REACHED", "DAILY_COST_LIMIT_REACHED", "MONTHLY_COST_LIMIT_REACHED", "PROVIDER_DISABLED", "MODEL_DISABLED", "PROVIDER_CLASSIFICATION_UNKNOWN", "AI_GLOBAL_BUDGET_EXCEEDED", "AI_PROVIDER_BUDGET_EXCEEDED", "AI_USER_BUDGET_EXCEEDED", "AI_DAILY_REQUEST_LIMIT_EXCEEDED"]);
const modelCodes = new Set(["MODEL_NOT_AVAILABLE", "MODEL_NOT_COMPATIBLE", "MODEL_NOT_CONFIGURED"]);

function testError(error: unknown) {
  if (!(error instanceof AiError)) return aiRouteError(error);
  const details = error.details || {};
  const stage = governanceCodes.has(error.category) ? "governance" : modelCodes.has(error.category) ? "model" : error.category === "PROVIDER_SECRET_UNAVAILABLE" ? "secret_resolution" : error.category === "PROVIDER_CONNECTION_FAILED" ? "network" : "provider";
  return NextResponse.json({ success: false, stage, code: error.category, message: error.toSafePayload().message, model: details.model, endpoint_mode: details.endpoint_mode, http_status: details.http_status, provider_error_type: details.provider_error_type, provider_error_code: details.provider_error_code, parameter: details.parameter, sanitized_reason: details.sanitized_provider_message || details.compatibility_reason, provider_request_id: details.provider_request_id, classification: details.provider_classification, classification_reason: details.classification_reason, correlation_id: details.correlation_id }, { status: error.status });
}

export async function GET(request: Request, { params }: { params: { providerId: string } }) {
  try {
    const userId = await requireAiAdmin();
    const provider = await resolveAiProvider(params.providerId);
    const requestedModel = new URL(request.url).searchParams.get("model")?.trim();
    const model = requestedModel || provider.defaultModel || "__connection_test__";
    const preview = await previewAiRequest({ request: { featureKey: "administrative_connection_test", messages: [{ role: "user", content: "Mixarr connection test." }], maxOutputTokens: 16, requestSource: "CONNECTION_TEST" }, provider, model, userId, enforceBudgets: true });
    return NextResponse.json({ success: true, stage: "governance_preflight", code: "ALLOWED", provider: provider.displayName, model, classification: preview.classification.classification, classification_reason: preview.classification.reason, effectivePolicy: preview.policyDecision, privacyMode: preview.privacyMode, costPricingState: preview.classification.pricingClassification });
  } catch (error) { return testError(error); }
}

export async function POST(request: Request, { params }: { params: { providerId: string } }) {
  try { const userId = await requireAiAdmin(); const body = await request.json().catch(() => ({})); const model = typeof body?.model === "string" && body.model.trim() ? body.model.trim() : undefined; return NextResponse.json(await testAiProviderConnection(params.providerId, request.signal, userId, false, model)); }
  catch (error) { return testError(error); }
}
