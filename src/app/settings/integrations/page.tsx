import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { isUserAdmin } from "@/lib/auth";
import IntegrationCenter from "@/components/IntegrationCenter";

const db = prisma as any;
export default async function IntegrationsPage() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) redirect("/");
  if (!(await isUserAdmin(userId))) redirect("/settings");
  const [servers, users, accounts, integrations, tokens, endpoints, deliveries, tests, mounts, collectionStates] = await Promise.all([
    db.server.findMany({ where: { userId }, orderBy: { priority: "asc" }, select: { id: true, name: true, uri: true, machineIdentifier: true, priority: true, enabled: true, role: true, availabilityState: true, failureCount: true, lastSuccessAt: true, lastFailureAt: true, lastFailureReason: true, responseLatencyMs: true, automaticFailover: true, minimumFailures: true, failoverCooldownMinutes: true, failoverWritePolicy: true, libraries: { select: { id: true, name: true, plexId: true, type: true, scanState: true, destructiveSyncBlockedUntil: true } } } }),
    db.user.findMany({ select: { id: true, username: true, email: true, _count: { select: { generatedPlaylists: true } }, plexUserMappings: { include: { server: { select: { id: true, name: true } }, plexAccount: { select: { id: true, username: true, email: true, accountType: true } } } } } }),
    db.plexAccount.findMany({ select: { id: true, serverId: true, plexUserId: true, username: true, email: true, accountType: true, lastSeenAt: true } }),
    db.integrationConfiguration.findMany({ select: { key: true, displayName: true, enabled: true, status: true, configurationJson: true, lastSuccessAt: true, lastFailureAt: true, lastFailureReason: true, failureCount: true, encryptedSecretJson: true } }),
    db.apiToken.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, description: true, prefix: true, scopesJson: true, enabled: true, revokedAt: true, expiresAt: true, lastUsedAt: true, createdAt: true } }),
    db.webhookEndpoint.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, displayName: true, enabled: true, eventsJson: true, timeoutMs: true, retryCount: true, lastSuccessAt: true, lastFailureAt: true, failureCount: true } }),
    db.webhookDelivery.findMany({ take: 25, orderBy: { createdAt: "desc" }, select: { id: true, deliveryId: true, status: true, httpStatus: true, attemptNumber: true, durationMs: true, errorCategory: true, errorMessage: true, createdAt: true, endpoint: { select: { displayName: true } }, eventRecord: { select: { event: true } } } }),
    db.integrationTestResult.findMany({ take: 25, orderBy: { createdAt: "desc" }, select: { id: true, testKey: true, status: true, safe: true, durationMs: true, message: true, createdAt: true } }),
    db.mountDependency.findMany({ orderBy: { displayName: "asc" }, select: { id: true, displayName: true, enabled: true, status: true, failureCount: true, lastCheckedAt: true, lastFailureReason: true, markerFile: true } }),
    db.plexCollectionState.findMany({ take: 25, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, itemCount: true, managedByMixarr: true, available: true, manualChangeState: true, lastSuccessfulUpdateAt: true } }),
  ]);
  return <IntegrationCenter initial={{ servers, users, accounts, integrations: integrations.map((row: any) => ({ ...row, encryptedSecretJson: undefined, secretsConfigured: !!row.encryptedSecretJson })), tokens, endpoints, deliveries, tests, mounts, collectionStates }} />;
}
