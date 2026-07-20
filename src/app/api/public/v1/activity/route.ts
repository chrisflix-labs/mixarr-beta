import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { authorizeApiRequest } from "@/lib/integrations/service";
import { integrationApiError } from "@/lib/integrations/api";
const db = prisma as any;
export const dynamic = "force-dynamic";
export async function GET(request: Request) { try { const auth = await authorizeApiRequest(request, "activity.read"); const items = await db.playlistOrchestrationAuditEvent.findMany({ where: { userId: auth.userId }, take: 100, orderBy: { createdAt: "desc" }, select: { id: true, eventType: true, severity: true, actorType: true, message: true, createdAt: true } }); return NextResponse.json({ data: items, schemaVersion: "1" }); } catch (error) { return integrationApiError(error); } }
