import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { authorizeApiRequest } from "@/lib/integrations/service";
import { integrationApiError } from "@/lib/integrations/api";
const db = prisma as any;
export const dynamic = "force-dynamic";
export async function GET(request: Request) { try { const auth = await authorizeApiRequest(request, "automations.read"); const items = await db.managedPlaylist.findMany({ where: { userId: auth.userId }, take: 100, orderBy: { updatedAt: "desc" }, select: { id: true, displayName: true, enabled: true, automationEnabled: true, priority: true, automationState: true, automationStateReason: true, orchestrationMode: true, lastCompletedAt: true, lastFailedAt: true, updatedAt: true } }); return NextResponse.json({ data: items, schemaVersion: "1" }); } catch (error) { return integrationApiError(error); } }
