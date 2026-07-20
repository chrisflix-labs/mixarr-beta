import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { authorizeApiRequest } from "@/lib/integrations/service";
import { integrationApiError } from "@/lib/integrations/api";
const db = prisma as any;
export const dynamic = "force-dynamic";
export async function GET(request: Request) { try { const auth = await authorizeApiRequest(request, "collections.read"); const serverIds = (await db.server.findMany({ where: { userId: auth.userId }, select: { id: true } })).map((row: any) => row.id); const items = await db.plexCollectionState.findMany({ where: { serverId: { in: serverIds } }, take: 100, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, summary: true, collectionType: true, itemCount: true, managedByMixarr: true, available: true, synchronizationDirection: true, syncMode: true, manualChangeState: true, lastModifiedAt: true, lastSuccessfulUpdateAt: true } }); return NextResponse.json({ data: items, schemaVersion: "1" }); } catch (error) { return integrationApiError(error); } }
