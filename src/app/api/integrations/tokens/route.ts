import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { integrationApiError, requireIntegrationAdmin } from "@/lib/integrations/api";
import { createScopedToken } from "@/lib/integrations/service";
const db = prisma as any;
export async function GET() { try { const userId = await requireIntegrationAdmin(); const tokens = await db.apiToken.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, description: true, prefix: true, scopesJson: true, enabled: true, revokedAt: true, expiresAt: true, lastUsedAt: true, createdAt: true } }); return NextResponse.json({ tokens }); } catch (error) { return integrationApiError(error); } }
export async function POST(request: Request) { try { const userId = await requireIntegrationAdmin(); const body = await request.json(); if (!String(body.name || "").trim()) return NextResponse.json({ error: "Token name is required." }, { status: 400 }); return NextResponse.json(await createScopedToken(userId, { name: String(body.name).trim().slice(0, 120), description: body.description ? String(body.description).slice(0, 500) : undefined, scopes: Array.isArray(body.scopes) ? body.scopes.map(String) : [], expiresAt: body.expiresAt || null }), { status: 201 }); } catch (error) { return integrationApiError(error); } }
