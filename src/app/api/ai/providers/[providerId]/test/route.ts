import { NextResponse } from "next/server";
import { aiRouteError, requireAiAdmin } from "@/ai/services/api";
import { testAiProviderConnection } from "@/ai/health/service";
import { previewAiRequest } from "@/ai/governance/service";
import { resolveAiProvider } from "@/ai/services/providerService";
import { AiError } from "@/ai/errors";

export const dynamic = "force-dynamic";
const governanceCodes = new Set(["AI_DISABLED", "USER_NOT_AUTHORIZED", "PAID_PROVIDER_NOT_PERMITTED", "BACKGROUND_REQUEST_NOT_PERMITTED", "MODEL_UNPRICED", "PRIVACY_MODE_INCOMPATIBLE", "DAILY_REQUEST_LIMIT_REACHED", "DAILY_COST_LIMIT_REACHED", "MONTHLY_COST_LIMIT_REACHED", "PROVIDER_DISABLED", "MODEL_DISABLED", "PROVIDER_CLASSIFICATION_UNKNOWN", "AI_GLOBAL_BUDGET_EXCEEDED", "AI_PROVIDER_BUDGET_EXCEEDED", "AI_USER_BUDGET_EXCEEDED", "AI_DAILY_REQUEST_LIMIT_EXCEEDED"]);

function testError(error: unknown) {
  if (!(error instanceof AiError)) return aiRouteError(error);
  const details = error.details || {};
  const stage = governanceCodes.has(error.category) ? "governance" : "provider";
  return NextResponse.json({ success: false, stage, code: error.category, message: error.toSafePayload().message, classification: details.provider_classification, classification_reason: details.classification_reason, correlation_id: details.correlation_id }, { status: error.status });
}

export async function GET(_request: Request, { params }: { params: { providerId: string } }) {
  try {
    const userId = await requireAiAdmin();
    const provider = await resolveAiProvider(params.providerId);
    const model = provider.defaultModel || "__connection_test__";
    const preview = await previewAiRequest({ request: { featureKey: "administrative_connection_test", messages: [{ role: "user", content: "Mixarr connection test." }], maxOutputTokens: 16, requestSource: "CONNECTION_TEST" }, provider, model, userId, enforceBudgets: true });
    return NextResponse.json({ success: true, stage: "governance_preflight", code: "ALLOWED", provider: provider.displayName, model, classification: preview.classification.classification, classification_reason: preview.classification.reason, effectivePolicy: preview.policyDecision, privacyMode: preview.privacyMode, costPricingState: preview.classification.pricingClassification });
  } catch (error) { return testError(error); }
}

export async function POST(request: Request, { params }: { params: { providerId: string } }) {
  try { const userId = await requireAiAdmin(); return NextResponse.json(await testAiProviderConnection(params.providerId, request.signal, userId)); }
  catch (error) { return testError(error); }
}
