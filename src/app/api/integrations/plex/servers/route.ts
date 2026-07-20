import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireIntegrationAdmin, integrationApiError } from "@/lib/integrations/api";

const db = prisma as any;
export async function GET() {
  try {
    const userId = await requireIntegrationAdmin();
    const servers = await db.server.findMany({ where: { userId }, orderBy: { priority: "asc" }, select: { id: true, name: true, uri: true, machineIdentifier: true, priority: true, enabled: true, role: true, availabilityState: true, failureCount: true, lastSuccessAt: true, lastFailureAt: true, lastFailureReason: true, responseLatencyMs: true, automaticFailover: true, minimumFailures: true, failoverCooldownMinutes: true, failoverWritePolicy: true, libraries: { select: { id: true, name: true, plexId: true, type: true } } } });
    return NextResponse.json({ servers });
  } catch (error) { return integrationApiError(error); }
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireIntegrationAdmin();
    const body = await request.json();
    const server = await db.server.findFirst({ where: { id: String(body.id), userId } });
    if (!server) return NextResponse.json({ error: "Plex server not found." }, { status: 404 });
    const updated = await db.server.update({ where: { id: server.id }, data: { name: body.name ? String(body.name).slice(0, 120) : undefined, priority: Number.isInteger(body.priority) ? Math.max(0, body.priority) : undefined, enabled: typeof body.enabled === "boolean" ? body.enabled : undefined, role: ["PRIMARY", "SECONDARY"].includes(body.role) ? body.role : undefined, automaticFailover: typeof body.automaticFailover === "boolean" ? body.automaticFailover : undefined, minimumFailures: Number.isInteger(body.minimumFailures) ? Math.min(20, Math.max(1, body.minimumFailures)) : undefined, failoverCooldownMinutes: Number.isInteger(body.failoverCooldownMinutes) ? Math.min(1440, Math.max(1, body.failoverCooldownMinutes)) : undefined, failoverWritePolicy: ["READ_ONLY", "ALLOW_WRITES"].includes(body.failoverWritePolicy) ? body.failoverWritePolicy : undefined }, select: { id: true, name: true, priority: true, enabled: true, role: true, automaticFailover: true, minimumFailures: true, failoverCooldownMinutes: true, failoverWritePolicy: true } });
    return NextResponse.json({ server: updated });
  } catch (error) { return integrationApiError(error); }
}
