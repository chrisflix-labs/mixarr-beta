import prisma from "@/lib/prisma";
import { reportUnknownFeatureIds } from "../features/registry";

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

// v2.4.12 startup validation. Warns (never throws) when persisted AI feature
// allowlists contain identifiers that are neither canonical nor a known legacy
// alias, so administrators can reconcile them. Reads only allowlist arrays — no
// prompts, responses, secrets, or credentials are touched.
export async function validateAiFeatureConfiguration() {
  const [providers, models, governance] = await Promise.all([
    prisma.aiProviderConfig.findMany({ where: { deletedAt: null }, select: { id: true, allowedFeaturesJson: true } }),
    prisma.aiProviderModel.findMany({ select: { allowedFeaturesJson: true } }),
    prisma.aiGovernanceSetting.findUnique({ where: { id: "global" }, select: { allowedExternalFeaturesJson: true } }),
  ]);
  const all = new Set<string>();
  for (const provider of providers) stringArray(provider.allowedFeaturesJson).forEach((id) => all.add(id));
  for (const model of models) stringArray(model.allowedFeaturesJson).forEach((id) => all.add(id));
  stringArray(governance?.allowedExternalFeaturesJson).forEach((id) => all.add(id));
  return reportUnknownFeatureIds(all, "startup_ai_feature_allowlist_validation");
}
