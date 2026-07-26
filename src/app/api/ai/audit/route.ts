import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { aiRouteError, requireAiAdmin } from "@/ai/services/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAiAdmin();
    const url = new URL(request.url);
    const take = Math.min(100, Math.max(1, Number(url.searchParams.get("take") || 50)));
    const cursor = url.searchParams.get("cursor");
    const where = {
      ...(url.searchParams.get("providerId") ? { providerConfigId: url.searchParams.get("providerId")! } : {}),
      ...(url.searchParams.get("model") ? { model: url.searchParams.get("model")! } : {}),
      ...(url.searchParams.get("userId") ? { userId: url.searchParams.get("userId")! } : {}),
      ...(url.searchParams.get("feature") ? { featureKey: url.searchParams.get("feature")! } : {}),
      ...(url.searchParams.get("privacyMode") ? { privacyMode: url.searchParams.get("privacyMode")! } : {}),
      ...(url.searchParams.get("requestSource") ? { requestSource: url.searchParams.get("requestSource")! } : {}),
      ...(url.searchParams.get("status") ? { status: url.searchParams.get("status")! } : {}),
      ...(url.searchParams.get("blockReason") ? { blockReason: url.searchParams.get("blockReason")! } : {})
    };
    const rows = await prisma.aiRequestAudit.findMany({
      where,
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true, requestId: true, logicalRequestId: true, correlationId: true, featureKey: true, userId: true,
        providerConfigId: true, providerType: true, providerDisplayName: true, model: true, providerModelClassification: true,
        status: true, requestSource: true, background: true, locationClassification: true, privacyMode: true,
        includedMetadataFields: true, transformedMetadataFields: true, blockedMetadataFields: true,
        startedAt: true, completedAt: true, latencyMs: true, providerDurationMs: true, timeToFirstTokenMs: true, retryCount: true,
        streamingUsed: true, cancellationStatus: true, inputTokenCount: true, outputTokenCount: true,
        totalTokenCount: true, cachedTokenCount: true, reasoningTokenCount: true, finishReason: true, configuredOutputTokenLimit: true,
        requestedOutputTokenLimit: true, effectiveOutputTokenLimit: true, outputTokenLimitingSource: true, thinkingModeRequested: true,
        reasoningContentDetected: true, reasoningCharacterCount: true, finalContentCharacterCount: true,
        finalContentStatus: true, truncationRecoveryAttempted: true, estimatedCost: true, actualCost: true,
        usageSource: true, pricingProfileId: true, responseByteCount: true, fallbackReason: true,
        httpStatus: true, providerRequestId: true, costState: true, structuredOutputResult: true, schemaValidationResult: true,
        budgetControlResult: true, limitControlResult: true, blockReason: true, errorCategory: true,
        sanitizedErrorCode: true, createdAt: true, provider: { select: { deletedAt: true } }
      }
    });
    const hasMore = rows.length > take;
    const records = rows.slice(0, take).map(({ provider, ...row }) => ({ ...row, providerDeleted: !!provider?.deletedAt, providerDisplayName: provider?.deletedAt ? `${row.providerDisplayName || row.providerType || "Deleted provider"} (Deleted)` : row.providerDisplayName }));
    return NextResponse.json({ records, nextCursor: hasMore ? rows[take - 1].id : null });
  } catch (error) { return aiRouteError(error); }
}
