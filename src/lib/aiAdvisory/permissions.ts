import prisma from "../prisma";
import { isUserAdmin } from "../auth";
import { requireAiPermission } from "../../ai/governance/permissions";

export const AI_ADVISORY_PERMISSIONS = [
  "ai.summary.view", "ai.summary.generate", "ai.summary.manage",
  "ai.metadata_suggestions.view", "ai.metadata_suggestions.generate", "ai.metadata_suggestions.review",
  "ai.metadata_suggestions.export", "ai.metadata_suggestions.manage_ignore_rules",
] as const;
export type AiAdvisoryPermission = typeof AI_ADVISORY_PERMISSIONS[number];

const failure = (code: string, message: string, status: number) => Object.assign(new Error(message), { code, status });

export async function requireAiAdvisoryPermission(userId: string | null | undefined, permission: AiAdvisoryPermission, ownerId?: string | null) {
  if (!userId) throw failure("UNAUTHORIZED", "Authentication is required.", 401);
  const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!exists) throw failure("UNAUTHORIZED", "The authenticated account no longer exists.", 401);
  const admin = await isUserAdmin(userId);
  if (ownerId && ownerId !== userId && !admin) throw failure("PERMISSION_DENIED", `Permission ${permission} is required for this artifact.`, 403);
  const granular = permission.startsWith("ai.metadata_suggestions") ? "ai.metadata.review" : permission.endsWith("generate") ? "ai.request.create" : "ai.use";
  await requireAiPermission(userId, "ai.use");
  if (!admin) await requireAiPermission(userId, granular);
  return { userId, permission, admin };
}
