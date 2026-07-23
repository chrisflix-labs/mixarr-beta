import prisma from "../../lib/prisma";
import { isUserAdmin } from "../../lib/auth";

export const AI_PERMISSIONS = [
  "ai.use",
  "ai.request.create",
  "ai.recipe.create",
  "ai.recipe.review",
  "ai.metadata.review",
  "ai.troubleshoot",
  "ai.provider.view",
  "ai.provider.manage",
  "ai.cost.view",
  "ai.cost.manage",
  "ai.audit.view",
] as const;

export type AiPermission = typeof AI_PERMISSIONS[number];

const FEATURE_PERMISSIONS: Record<string, AiPermission> = {
  natural_language_playlist_requests: "ai.recipe.create",
  recipe_copilot: "ai.recipe.create",
  playlist_ai_summaries: "ai.request.create",
  metadata_suggestions: "ai.metadata.review",
  troubleshooting_explanations: "ai.troubleshoot",
  recommendation_explanations: "ai.request.create",
  administrative_connection_test: "ai.provider.manage",
  administrative_model_discovery: "ai.provider.manage",
};

const failure = (code: string, message: string, status: number) => Object.assign(new Error(message), { code, status });

export function permissionForAiFeature(featureKey: string): AiPermission {
  return FEATURE_PERMISSIONS[featureKey] || "ai.request.create";
}

export async function getAiCapabilities(userId: string | null | undefined) {
  if (!userId) return { authenticated: false, admin: false, permissions: [] as AiPermission[] };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return { authenticated: false, admin: false, permissions: [] as AiPermission[] };
  if (await isUserAdmin(userId)) return { authenticated: true, admin: true, permissions: [...AI_PERMISSIONS] };
  const now = new Date();
  const grants = await prisma.aiPermissionGrant.findMany({
    where: { userId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    select: { permission: true },
  });
  const permissions = grants.map((row) => row.permission).filter((permission): permission is AiPermission => AI_PERMISSIONS.includes(permission as AiPermission));
  return { authenticated: true, admin: false, permissions };
}

export async function requireAiPermission(userId: string | null | undefined, permission: AiPermission) {
  if (!userId) throw failure("UNAUTHORIZED", "Authentication is required.", 401);
  const capabilities = await getAiCapabilities(userId);
  if (!capabilities.authenticated) throw failure("UNAUTHORIZED", "Authentication is required.", 401);
  if (!capabilities.permissions.includes(permission)) throw failure("PERMISSION_DENIED", `Permission ${permission} is required.`, 403);
  return { userId, permission, admin: capabilities.admin };
}

export async function requireAiFeaturePermission(userId: string | null | undefined, featureKey: string) {
  await requireAiPermission(userId, "ai.use");
  await requireAiPermission(userId, "ai.request.create");
  return requireAiPermission(userId, permissionForAiFeature(featureKey));
}

export async function setAiPermissionGrant(input: { actorId: string; userId: string; permission: AiPermission; granted: boolean; reason?: string; expiresAt?: Date | null }) {
  if (!(await isUserAdmin(input.actorId))) throw failure("PERMISSION_DENIED", "Administrator access is required.", 403);
  const now = new Date();
  const row = await prisma.aiPermissionGrant.upsert({
    where: { userId_permission: { userId: input.userId, permission: input.permission } },
    create: { userId: input.userId, permission: input.permission, grantedBy: input.actorId, reason: input.reason?.slice(0, 1000), expiresAt: input.expiresAt },
    update: input.granted
      ? { grantedBy: input.actorId, reason: input.reason?.slice(0, 1000), expiresAt: input.expiresAt, revokedAt: null, revokedBy: null }
      : { revokedAt: now, revokedBy: input.actorId, reason: input.reason?.slice(0, 1000) },
  });
  await prisma.aiGovernanceAudit.create({ data: { actorId: input.actorId, action: input.granted ? "AI_PERMISSION_GRANTED" : "AI_PERMISSION_REVOKED", entityType: "AiPermissionGrant", entityId: row.id, newValueJson: { userId: input.userId, permission: input.permission, granted: input.granted, expiresAt: input.expiresAt?.toISOString() || null } } });
  return row;
}
