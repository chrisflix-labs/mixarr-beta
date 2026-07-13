import prisma from "../prisma";

export async function createRecentlyAddedNotification({
  userId,
  batchKey,
  triggerType,
  title,
  message,
  link = "/recently-added",
}: {
  userId: string;
  batchKey: string;
  triggerType: string;
  title: string;
  message: string;
  link?: string | null;
}) {
  const settings = await prisma.recentlyAddedSettings.findUnique({ where: { userId } });
  if (!settings?.enabled || !settings.notificationEnabled) return null;
  const toggle = triggerType === "strong_matches" ? settings.notifyStrongMatches
    : triggerType === "suggestions_ready" ? settings.notifySuggestionsReady
    : triggerType === "automatic_additions" ? settings.notifyAutomaticAdditions
    : triggerType === "mix_created" ? settings.notifyMixCreated
    : triggerType === "low_confidence" ? settings.notifyLowConfidence
    : settings.notifyFailures;
  if (!toggle) return null;
  return prisma.recentlyAddedNotificationState.upsert({
    where: { userId_batchKey_triggerType: { userId, batchKey, triggerType } },
    update: {},
    create: { userId, batchKey, triggerType, title, message, link },
  });
}

export async function markRecentlyAddedNotificationsRead(userId: string, ids?: string[]) {
  return prisma.recentlyAddedNotificationState.updateMany({
    where: { userId, readAt: null, ...(ids?.length ? { id: { in: ids.slice(0, 500) } } : {}) },
    data: { readAt: new Date() },
  });
}

