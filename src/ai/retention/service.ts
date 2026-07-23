import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

const cutoff = (days: number, now: Date) => new Date(now.getTime() - Math.max(0, days) * 86_400_000);

export async function runAiRetentionCleanup(input: { actorId?: string; batchSize?: number; now?: Date } = {}) {
  const now = input.now || new Date();
  const batchSize = Math.max(1, Math.min(1000, input.batchSize || 250));
  const policy = await prisma.aiGovernanceSetting.findUnique({ where: { id: "global" } });
  if (!policy) return { requestsPurged: 0, responsesPurged: 0, quarantinesDeleted: 0, securityEventsDeleted: 0 };
  const requestRows = await prisma.aiRequestAudit.findMany({ where: { requestBodyPurgedAt: null, createdAt: { lt: cutoff(policy.requestBodyRetentionDays, now) } }, select: { id: true }, take: batchSize });
  const responseRows = await prisma.aiResponseRecord.findMany({ where: { bodyPurgedAt: null, createdAt: { lt: cutoff(policy.responseBodyRetentionDays, now) } }, select: { id: true }, take: batchSize });
  const quarantineRows = await prisma.aiQuarantineRecord.findMany({ where: { status: { in: ["REJECTED", "DISMISSED"] }, createdAt: { lt: cutoff(policy.quarantineRetentionDays, now) } }, select: { id: true }, take: batchSize });
  const securityRows = await prisma.aiSecurityEvent.findMany({ where: { createdAt: { lt: cutoff(policy.auditRetentionDays, now) } }, select: { id: true }, take: batchSize });
  return prisma.$transaction(async (tx) => {
    const requests = requestRows.length ? await tx.aiRequestAudit.updateMany({ where: { id: { in: requestRows.map((row) => row.id) } }, data: { requestBodyJson: Prisma.DbNull, requestBodyPurgedAt: now } }) : { count: 0 };
    const responses = responseRows.length ? await tx.aiResponseRecord.updateMany({ where: { id: { in: responseRows.map((row) => row.id) } }, data: { bodyJson: Prisma.DbNull, bodyText: null, bodyPurgedAt: now } }) : { count: 0 };
    const quarantines = quarantineRows.length ? await tx.aiQuarantineRecord.deleteMany({ where: { id: { in: quarantineRows.map((row) => row.id) } } }) : { count: 0 };
    const security = securityRows.length ? await tx.aiSecurityEvent.deleteMany({ where: { id: { in: securityRows.map((row) => row.id) } } }) : { count: 0 };
    await tx.aiGovernanceAudit.create({ data: { actorId: input.actorId || "system", action: "AI_RETENTION_CLEANUP", entityType: "AiGovernanceSetting", entityId: "global", newValueJson: { requestsPurged: requests.count, responsesPurged: responses.count, quarantinesDeleted: quarantines.count, securityEventsDeleted: security.count, batchSize, completedAt: now.toISOString() } } });
    return { requestsPurged: requests.count, responsesPurged: responses.count, quarantinesDeleted: quarantines.count, securityEventsDeleted: security.count };
  });
}
