import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { aiRouteError, AiPolicyValidationError, requireAiPermission } from "@/ai/services/api";
import { aiUserPolicySchema, fieldErrorsFromZod } from "@/ai/governance/userPolicy";
import { AI_REQUEST_LIMIT_MODES, MAXIMUM_AI_REQUEST_LIMIT, validateRequestLimitConfiguration } from "@/ai/governance/requestLimits";
import { assertActiveAiProviderId } from "@/ai/services/providerService";
export const dynamic = "force-dynamic";
const requestCount = z.number().int().min(1, "Enter 1 or more requests, or choose Unlimited. Zero is not a valid limit.").max(MAXIMUM_AI_REQUEST_LIMIT).nullable().optional();
const providerSchema = z.object({ scope: z.literal("provider"), providerConfigId: z.string().uuid(), currency: z.string().regex(/^[A-Z]{3}$/).default("USD"), dailyLimit: z.union([z.number().nonnegative(), z.string(), z.null()]).optional(), monthlyLimit: z.union([z.number().nonnegative(), z.string(), z.null()]).optional(), warningThresholds: z.array(z.number().min(0).max(1)).default([0.5, 0.75, 0.9, 1]), hardLimitEnabled: z.boolean().default(true), selectableAfterWarning: z.boolean().default(true), allowFallbackWhenExhausted: z.boolean().default(false), dailyRequestLimitMode: z.enum(AI_REQUEST_LIMIT_MODES).default("INHERIT"), dailyRequestLimit: requestCount, monthlyRequestLimit: requestCount, maximumInputTokens: z.number().int().positive().nullable().optional(), maximumOutputTokens: z.number().int().positive().nullable().optional(), maximumCombinedTokens: z.number().int().positive().nullable().optional(), reason: z.string().max(1000).optional() });
export async function GET() { try { await requireAiPermission("MANAGE_AI_BUDGETS"); const [providers, users, availableUsers] = await Promise.all([prisma.aiProviderBudget.findMany({ include: { provider: { select: { displayName: true } } }, orderBy: { provider: { displayName: "asc" } } }), prisma.aiUserLimit.findMany({ orderBy: { userId: "asc" } }), prisma.user.findMany({ select: { id: true, username: true, email: true }, orderBy: { username: "asc" } })]); return NextResponse.json({ providers, users, availableUsers }); } catch (error) { return aiRouteError(error); } }
export async function PUT(request: Request) { try { const actorId = await requireAiPermission("MANAGE_AI_BUDGETS"); const raw = await request.json(); if (raw.scope === "provider") { const { scope, warningThresholds, reason, ...parsedProvider } = providerSchema.parse(raw); const providerDailyRequests = validateRequestLimitConfiguration({ mode: parsedProvider.dailyRequestLimitMode, limit: parsedProvider.dailyRequestLimit }); if (!providerDailyRequests.ok) throw new AiPolicyValidationError({ [providerDailyRequests.field === "mode" ? "provider_daily_requests_mode" : "provider_daily_requests"]: providerDailyRequests.error }); const input = { ...parsedProvider, dailyRequestLimitMode: providerDailyRequests.mode, dailyRequestLimit: providerDailyRequests.limit }; await assertActiveAiProviderId(input.providerConfigId); const previous = await prisma.aiProviderBudget.findUnique({ where: { providerConfigId: input.providerConfigId } }); const row = await prisma.$transaction(async (tx) => { const saved = await tx.aiProviderBudget.upsert({ where: { providerConfigId: input.providerConfigId }, create: { ...input, warningThresholdsJson: warningThresholds } as any, update: { ...input, warningThresholdsJson: warningThresholds } as any }); await tx.aiGovernanceAudit.create({ data: { actorId, action: "PROVIDER_BUDGET_UPDATED", entityType: "AiProviderBudget", entityId: saved.id, previousValueJson: previous as any, newValueJson: saved as any, reason } }); return saved; }); return NextResponse.json(row); }
    const compatibleRaw = { ...raw, userId: raw.userId ?? raw.user_uuid };
    const parsed = aiUserPolicySchema.safeParse(compatibleRaw);
    if (!parsed.success) throw new AiPolicyValidationError(fieldErrorsFromZod(parsed.error));
    const { scope, allowedPrivacyModes, allowedProviderIds, allowedModelTiers, reason, ...parsedUser } = parsed.data;
    const userDailyRequests = validateRequestLimitConfiguration({ mode: parsedUser.dailyRequestLimitMode, limit: parsedUser.dailyRequestLimit });
    if (!userDailyRequests.ok) throw new AiPolicyValidationError({ [userDailyRequests.field === "mode" ? "daily_requests_mode" : "daily_requests"]: userDailyRequests.error });
    const input = { ...parsedUser, dailyRequestLimitMode: userDailyRequests.mode, dailyRequestLimit: userDailyRequests.limit };
    for (const providerId of allowedProviderIds || []) await assertActiveAiProviderId(providerId);
    const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true } });
    if (!user) throw new AiPolicyValidationError({ user_uuid: "No Mixarr user exists with this UUID." });
    const previous = await prisma.aiUserLimit.findUnique({ where: { userId: input.userId } });
    const row = await prisma.$transaction(async (tx) => {
      const data = { ...input, ...(allowedPrivacyModes !== undefined ? { allowedPrivacyModesJson: allowedPrivacyModes } : {}), ...(allowedProviderIds !== undefined ? { allowedProviderIdsJson: allowedProviderIds } : {}), ...(allowedModelTiers !== undefined ? { allowedModelTiersJson: allowedModelTiers } : {}) } as any;
      const saved = await tx.aiUserLimit.upsert({ where: { userId: input.userId }, create: data, update: data });
      await tx.aiGovernanceAudit.create({ data: { actorId, action: "USER_AI_LIMIT_UPDATED", entityType: "AiUserLimit", entityId: saved.id, previousValueJson: previous as any, newValueJson: saved as any, reason } }); return saved;
    });
    return NextResponse.json(row);
  } catch (error) { return aiRouteError(error); } }
