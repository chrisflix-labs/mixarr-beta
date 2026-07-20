import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { aiRouteError, requireAiPermission } from "@/ai/services/api";
export const dynamic = "force-dynamic";
export async function GET() { try { await requireAiPermission("MANAGE_AI_BUDGETS"); const reservations = await prisma.aiBudgetReservation.findMany({ where: { status: "ACTIVE", expiresAt: { gt: new Date() } }, include: { provider: { select: { displayName: true } } }, orderBy: { createdAt: "desc" }, take: 250 }); return NextResponse.json({ reservations }); } catch (error) { return aiRouteError(error); } }
