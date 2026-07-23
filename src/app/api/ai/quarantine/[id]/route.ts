import { NextResponse } from "next/server";
import { aiRouteError, requireAiPermission } from "@/ai/services/api";
import prisma from "@/lib/prisma";
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: { id: string } }) { try { await requireAiPermission("ai.audit.view"); const record = await prisma.aiQuarantineRecord.findUnique({ where: { id: params.id } }); return record ? NextResponse.json({ record }) : NextResponse.json({ error: { code: "NOT_FOUND", message: "Quarantine record not found." } }, { status: 404 }); } catch (error) { return aiRouteError(error); } }
