import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { aiRouteError, requireAiPermission } from "@/ai/services/api";
import { AI_PERMISSIONS, setAiPermissionGrant } from "@/ai/governance/permissions";

export const dynamic = "force-dynamic";
const schema = z.object({ userId: z.string().uuid(), permission: z.enum(AI_PERMISSIONS), granted: z.boolean(), reason: z.string().max(1000).optional(), expiresAt: z.string().datetime().nullable().optional() }).strict();
export async function GET(request: Request) { try { await requireAiPermission("ai.provider.manage"); const userId = new URL(request.url).searchParams.get("userId"); return NextResponse.json({ permissions: AI_PERMISSIONS, grants: await prisma.aiPermissionGrant.findMany({ where: userId ? { userId } : {}, orderBy: [{ userId: "asc" }, { permission: "asc" }] }) }); } catch (error) { return aiRouteError(error); } }
export async function PUT(request: Request) { try { const actorId = await requireAiPermission("ai.provider.manage"); const input = schema.parse(await request.json()); return NextResponse.json({ grant: await setAiPermissionGrant({ ...input, actorId, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null }) }); } catch (error) { return aiRouteError(error); } }
