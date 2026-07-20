import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { integrationApiError, requireIntegrationAdmin } from "@/lib/integrations/api";
import { ecosystemStatus, runMountChecks, testPlexServer } from "@/lib/integrations/service";
const db = prisma as any;
export async function POST() { try { const userId = await requireIntegrationAdmin(); const servers = await db.server.findMany({ where: { userId, enabled: true }, select: { id: true } }); const results: any[] = []; for (const server of servers) results.push({ key: `plex:${server.id}`, result: await testPlexServer(server.id, userId) }); results.push({ key: "mounts", result: await runMountChecks() }); results.push({ key: "status", result: await ecosystemStatus(userId) }); return NextResponse.json({ status: results.every((item) => item.result?.status !== "FAILED") ? "PASSED" : "FAILED", safe: true, results }); } catch (error) { return integrationApiError(error); } }
