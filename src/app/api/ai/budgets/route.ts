import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { aiRouteError, AiPolicyValidationError, requireAiPermission } from "@/ai/services/api";
import { aiUserPolicySchema, fieldErrorsFromZod } from "@/ai/governance/userPolicy";
import { resolvePerRequestCostLimit } from "@/ai/governance/policy";
import { assertActiveAiProviderId } from "@/ai/services/providerService";
export const dynamic = "force-dynamic";
const optionalDecimal = z.preprocess((value) => typeof value === "string" && value.trim() === "" ? null : typeof value === "string" ? value.trim() : value, z.union([z.number().finite(), z.string().regex(/^\d+(\.\d{1,6})?$/, "Enter a valid amount with no more than 6 decimal places."), z.null()]).optional());
const providerSchema = z.object({ scope: z.literal("provider"), providerConfigId: z.string().uuid(), currency: z.string().regex(/^[A-Z]{3}$/).default("USD"), dailyLimit: z.union([z.number().nonnegative(), z.string(), z.null()]).optional(), monthlyLimit: z.union([z.number().nonnegative(), z.string(), z.null()]).optional(), perRequestCostLimitEnabled: z.boolean().optional(), perRequestCostLimitUsd: optionalDecimal, warningThresholds: z.array(z.number().min(0).max(1)).default([0.5, 0.75, 0.9, 1]), hardLimitEnabled: z.boolean().default(true), selectableAfterWarning: z.boolean().default(true), allowFallbackWhenExhausted: z.boolean().default(false), dailyRequestLimit: z.number().int().positive().nullable().optional(), monthlyRequestLimit: z.number().int().positive().nullable().optional(), maximumInputTokens: z.number().int().positive().nullable().optional(), maximumOutputTokens: z.number().int().positive().nullable().optional(), maximumCombinedTokens: z.number().int().positive().nullable().optional(), reason: z.string().max(1000).optional() }).superRefine((input, context) => {
  if (input.perRequestCostLimitEnabled === true && (input.perRequestCostLimitUsd == null || !Number.isFinite(Number(input.perRequestCostLimitUsd)) || Number(input.perRequestCostLimitUsd) <= 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["perRequestCostLimitUsd"], message: "Enter a per-request cost limit greater than zero when enforcement is enabled." });
  }
});
export async function GET() { try { await requireAiPermission("MANAGE_AI_BUDGETS"); const [providers, users, availableUsers] = await Promise.all([prisma.aiProviderBudget.findMany({ include: { provider: { select: { displayName: true } } }, orderBy: { provider: { displayName: "asc" } } }), prisma.aiUserLimit.findMany({ orderBy: { userId: "asc" } }), prisma.user.findMany({ select: { id: true, username: true, email: true }, orderBy: { username: "asc" } })]); return NextResponse.json({ providers, users, availableUsers }); } catch (error) { return aiRouteError(error); } }
export async function PUT(request: Request) { try { const actorId = await requireAiPermission("MANAGE_AI_BUDGETS"); const raw = await request.json(); if (raw.scope === "provider") { const { scope, warningThresholds, reason, ...input } = providerSchema.parse(raw); await assertActiveAiProviderId(input.providerConfigId); const previous = await prisma.aiProviderBudget.findUnique({ where: { providerConfigId: input.providerConfigId } }); resolvePerRequestCostLimit([{ source: "provider", enabled: input.perRequestCostLimitEnabled ?? previous?.perRequestCostLimitEnabled, value: input.perRequestCostLimitUsd !== undefined ? input.perRequestCostLimitUsd : previous?.perRequestCostLimitUsd?.toString() }]); const row = await prisma.$transaction(async (tx) => { const saved = await tx.aiProviderBudget.upsert({ where: { providerConfigId: input.providerConfigId }, create: { ...input, warningThresholdsJson: warningThresholds } as any, update: { ...input, warningThresholdsJson: warningThresholds } as any }); await tx.aiGovernanceAudit.create({ data: { actorId, action: "PROVIDER_BUDGET_UPDATED", entityType: "AiProviderBudget", entityId: saved.id, previousValueJson: previous as any, newValueJson: saved as any, reason } }); return saved; }); return NextResponse.json(row); }
    const compatibleRaw = { ...raw, userId: raw.userId ?? raw.user_uuid };
    const parsed = aiUserPolicySchema.safeParse(compatibleRaw);
    if (!parsed.success) throw new AiPolicyValidationError(fieldErrorsFromZod(parsed.error));
    const { scope, allowedPrivacyModes, allowedProviderIds, allowedModelTiers, reason, ...input } = parsed.data;
    for (const providerId of allowedProviderIds || []) await assertActiveAiProviderId(providerId);
    const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true } });
    if (!user) throw new AiPolicyValidationError({ user_uuid: "No Mixarr user exists with this UUID." });
    const previous = await prisma.aiUserLimit.findUnique({ where: { userId: input.userId } });
    resolvePerRequestCostLimit([{ source: "user", enabled: input.perRequestCostLimitEnabled ?? previous?.perRequestCostLimitEnabled, value: input.perRequestCostLimitUsd !== undefined ? input.perRequestCostLimitUsd : previous?.perRequestCostLimitUsd?.toString() }]);
    const row = await prisma.$transaction(async (tx) => {
      const data = { ...input, ...(allowedPrivacyModes !== undefined ? { allowedPrivacyModesJson: allowedPrivacyModes } : {}), ...(allowedProviderIds !== undefined ? { allowedProviderIdsJson: allowedProviderIds } : {}), ...(allowedModelTiers !== undefined ? { allowedModelTiersJson: allowedModelTiers } : {}) } as any;
      const saved = await tx.aiUserLimit.upsert({ where: { userId: input.userId }, create: data, update: data });
      await tx.aiGovernanceAudit.create({ data: { actorId, action: "USER_AI_LIMIT_UPDATED", entityType: "AiUserLimit", entityId: saved.id, previousValueJson: previous as any, newValueJson: saved as any, reason } }); return saved;
    });
    return NextResponse.json(row);
  } catch (error) { return aiRouteError(error); } }
