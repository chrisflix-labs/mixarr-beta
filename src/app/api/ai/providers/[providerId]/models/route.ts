import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { aiRouteError, requireAiAdmin, requireAiPermission } from "@/ai/services/api";
import { getAiProvider } from "@/ai/services/providerService";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: { providerId: string } }) { try { await requireAiAdmin(); await getAiProvider(params.providerId); const models = await prisma.aiProviderModel.findMany({ where: { providerConfigId: params.providerId }, orderBy: [{ availabilityStatus: "asc" }, { displayName: "asc" }] }); return NextResponse.json({ models }); } catch (error) { return aiRouteError(error); } }

const tokenLimitSchema = z.object({
  modelIdentifier: z.string().min(1).max(300),
  maximumInputTokens: z.number().int().positive().max(2_000_000).nullable().optional(),
  maximumOutputTokens: z.number().int().positive().max(2_000_000).nullable().optional(),
  maximumCombinedTokens: z.number().int().min(2).max(4_000_000).nullable().optional(),
  reason: z.string().max(1000).optional()
});

export async function PATCH(request: Request, { params }: { params: { providerId: string } }) {
  try {
    const actorId = await requireAiPermission("MANAGE_AI_TOKEN_LIMITS");
    await getAiProvider(params.providerId);
    const { modelIdentifier, reason, ...limits } = tokenLimitSchema.parse(await request.json());
    const key = { providerConfigId_modelIdentifier: { providerConfigId: params.providerId, modelIdentifier } };
    const previous = await prisma.aiProviderModel.findUnique({ where: key });
    if (!previous) return NextResponse.json({ error: { code: "MODEL_NOT_FOUND", message: "The selected provider model was not found." } }, { status: 404 });
    const model = await prisma.$transaction(async (tx) => {
      const updated = await tx.aiProviderModel.update({ where: key, data: limits });
      await tx.aiGovernanceAudit.create({ data: { actorId, action: "MODEL_TOKEN_LIMITS_UPDATED", entityType: "AiProviderModel", entityId: updated.id, previousValueJson: previous as any, newValueJson: updated as any, reason } });
      return updated;
    });
    return NextResponse.json({ model });
  } catch (error) { return aiRouteError(error); }
}
