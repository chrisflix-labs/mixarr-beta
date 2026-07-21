import { AiError } from "../errors";
import { sanitizeAiError } from "../security";

export type UnexpectedAiErrorContext = {
  correlationId?: string;
  featureName?: string;
  userId?: string;
  providerId?: string;
  providerType?: string;
  model?: string | null;
  privacyMode?: string;
  paidProviderPermission?: boolean;
  backgroundRequestPermission?: boolean;
  governanceDecisionStage: string;
};

function sanitizedStack(exception: Error) {
  if (!exception.stack) return undefined;
  const frames = exception.stack.split("\n").slice(1).filter((line) => /^\s*at\s/.test(line));
  return [`${exception.name}: [sanitized message]`, ...frames].join("\n");
}

export function unexpectedAiError(error: unknown, context: UnexpectedAiErrorContext) {
  const correlationId = context.correlationId || crypto.randomUUID();
  const exception = error instanceof Error ? error : new Error("Unknown AI error");
  console.error("[AI] Unexpected request failure", {
    correlationId,
    featureName: context.featureName,
    userId: context.userId,
    providerId: context.providerId,
    providerType: context.providerType,
    model: context.model,
    privacyMode: context.privacyMode,
    paidProviderPermission: context.paidProviderPermission,
    backgroundRequestPermission: context.backgroundRequestPermission,
    governanceDecisionStage: context.governanceDecisionStage,
    exceptionClass: exception.name,
    sanitizedExceptionMessage: sanitizeAiError(exception),
    stack: sanitizedStack(exception)
  });
  return new AiError("INTERNAL_AI_ERROR", undefined, 500, undefined, { correlation_id: correlationId });
}
