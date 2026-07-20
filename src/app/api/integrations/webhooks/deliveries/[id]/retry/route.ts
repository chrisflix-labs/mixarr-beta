import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { integrationApiError, requireIntegrationAdmin } from "@/lib/integrations/api";
import { deliverWebhook } from "@/lib/integrations/service";
const db = prisma as any;
export async function POST(_: Request, { params }: { params: { id: string } }) { try { await requireIntegrationAdmin(); const original = await db.webhookDelivery.findUnique({ where: { id: params.id } }); if (!original) return NextResponse.json({ error: "Delivery not found." }, { status: 404 }); const retry = await db.webhookDelivery.create({ data: { deliveryId: original.deliveryId, eventId: original.eventId, endpointId: original.endpointId, attemptNumber: original.attemptNumber + 1 } }); await deliverWebhook(retry.id); return NextResponse.json({ deliveryId: retry.id, status: "SUCCEEDED" }); } catch (error) { return integrationApiError(error); } }
