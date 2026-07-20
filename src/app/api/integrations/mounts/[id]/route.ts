import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { integrationApiError, requireIntegrationAdmin } from "@/lib/integrations/api";
const db = prisma as any;
export async function DELETE(_: Request, { params }: { params: { id: string } }) { try { await requireIntegrationAdmin(); await db.mountDependency.delete({ where: { id: params.id } }); return NextResponse.json({ removed: true }); } catch (error) { return integrationApiError(error); } }
