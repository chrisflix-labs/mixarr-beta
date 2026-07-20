import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { authorizeApiRequest, ecosystemStatus } from "@/lib/integrations/service";
import { integrationApiError } from "@/lib/integrations/api";
const db = prisma as any;
export const dynamic = "force-dynamic";
export async function GET(request: Request) { try { const auth = await authorizeApiRequest(request, "integrations.read"); const [ecosystem, integrations] = await Promise.all([ecosystemStatus(auth.userId), db.integrationConfiguration.findMany({ select: { key: true, displayName: true, enabled: true, status: true, lastSuccessAt: true, lastFailureAt: true, failureCount: true } })]); return NextResponse.json({ data: { ecosystem, integrations }, schemaVersion: "1" }); } catch (error) { return integrationApiError(error); } }
