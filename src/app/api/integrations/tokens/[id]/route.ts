import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { integrationApiError, requireIntegrationAdmin } from "@/lib/integrations/api";
const db = prisma as any;
export async function DELETE(_: Request, { params }: { params: { id: string } }) { try { const userId = await requireIntegrationAdmin(); const token = await db.apiToken.findFirst({ where: { id: params.id, userId } }); if (!token) return NextResponse.json({ error: "API token not found." }, { status: 404 }); await db.$transaction([db.apiToken.update({ where: { id: token.id }, data: { enabled: false, revokedAt: new Date() } }), db.apiTokenAuditEvent.create({ data: { tokenId: token.id, eventType: "REVOKED", actorId: userId } })]); return NextResponse.json({ revoked: true }); } catch (error) { return integrationApiError(error); } }
