import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { aiRouteError, requireAiPermission } from "@/ai/services/api";
import { getAiProvider } from "@/ai/services/providerService";
export const dynamic = "force-dynamic";
const publicModel = (model: any) => { const { maximumInputTokens: _input, maximumOutputTokens: _output, maximumCombinedTokens: _combined, ...safe } = model; return safe; };
export async function GET(_request: Request, { params }: { params: { providerId: string } }) { try { await requireAiPermission("ai.provider.view"); await getAiProvider(params.providerId); const models = await prisma.aiProviderModel.findMany({ where: { providerConfigId: params.providerId }, orderBy: [{ availabilityStatus: "asc" }, { displayName: "asc" }] }); return NextResponse.json({ models: models.map(publicModel) }); } catch (error) { return aiRouteError(error); } }

const modelConfigurationSchema = z.object({
  modelIdentifier: z.string().min(1).max(300),
  enabled: z.boolean().optional(), approved: z.boolean().optional(), allowedFeatures: z.array(z.string().min(1).max(120)).max(100).optional(), capabilities: z.array(z.string().min(1).max(120)).max(100).optional(), structuredOutput: z.boolean().optional(), jsonMode: z.boolean().optional(), toolCalling: z.boolean().optional(), deprecated: z.boolean().optional(), maximumConcurrency: z.number().int().positive().max(1000).nullable().optional(), reason: z.string().max(1000).optional()
});

export async function PATCH(request: Request, { params }: { params: { providerId: string } }) {
  try {
    const actorId = await requireAiPermission("ai.provider.manage");
    await getAiProvider(params.providerId);
    const raw = await request.json();
    const { modelIdentifier, reason, allowedFeatures, capabilities, approved, ...configuration } = modelConfigurationSchema.parse(raw);
    const key = { providerConfigId_modelIdentifier: { providerConfigId: params.providerId, modelIdentifier } };
    const previous = await prisma.aiProviderModel.findUnique({ where: key });
    if (!previous) return NextResponse.json({ error: { code: "MODEL_NOT_FOUND", message: "The selected provider model was not found." } }, { status: 404 });
    const model = await prisma.$transaction(async (tx) => {
      const updated = await tx.aiProviderModel.update({ where: key, data: { ...configuration, ...(allowedFeatures ? { allowedFeaturesJson: allowedFeatures } : {}), ...(capabilities ? { capabilitiesJson: capabilities } : {}), ...(approved === undefined ? {} : { approved, approvedBy: approved ? actorId : null, approvedAt: approved ? new Date() : null }) } });
      await tx.aiGovernanceAudit.create({ data: { actorId, action: "MODEL_CONFIGURATION_UPDATED", entityType: "AiProviderModel", entityId: updated.id, previousValueJson: publicModel(previous) as any, newValueJson: publicModel(updated) as any, reason } });
      return updated;
    });
    return NextResponse.json({ model: publicModel(model), ...(Object.keys(raw).some((key) => /token/i.test(key)) ? { warnings: ["Deprecated token-limit fields were ignored."] } : {}) });
  } catch (error) { return aiRouteError(error); }
}
