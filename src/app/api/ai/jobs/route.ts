import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { aiRouteError } from "@/ai/services/api";
import { getAiCapabilities } from "@/ai/governance/permissions";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const userId = cookies().get("mixarr_session")?.value, capabilities = await getAiCapabilities(userId);
    if (!userId || !capabilities.authenticated) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Authentication is required." } }, { status: 401 });
    const url = new URL(request.url), page = Math.max(1, Number(url.searchParams.get("page") || 1)), pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") || 25)));
    const where = { ...(capabilities.permissions.includes("ai.audit.view") ? {} : { userId }), ...(url.searchParams.get("status") ? { status: url.searchParams.get("status")! } : {}), ...(url.searchParams.get("feature") ? { featureKey: url.searchParams.get("feature")! } : {}) };
    const [jobs, total] = await Promise.all([prisma.aiJob.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, requestId: true, userId: true, featureKey: true, jobType: true, priority: true, providerConfigId: true, model: true, status: true, waitingReason: true, attemptCount: true, maximumAttempts: true, progressJson: true, errorCode: true, redactedErrorMessage: true, queuedAt: true, startedAt: true, completedAt: true, cancellationRequestedAt: true, createdAt: true, updatedAt: true } }), prisma.aiJob.count({ where })]);
    return NextResponse.json({ jobs, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
  } catch (error) { return aiRouteError(error); }
}
