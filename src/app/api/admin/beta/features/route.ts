import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdminUser } from "@/lib/auth";
import { betaApiError } from "@/lib/betaApi";
import { featureFlagRegistry, isFeatureImplemented, normalizeBetaAccessLevel } from "@/lib/featureFlagRegistry";
import { configuredServerBetaLevel } from "@/lib/featureFlagService";

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  try {
    await requireAdminUser(userId);
    const [overrides, access, users, sponsorsState] = await Promise.all([
      prisma.featureFlagOverride.findMany({ orderBy: { featureKey: "asc" } }),
      prisma.userBetaAccess.findMany({ orderBy: { updatedAt: "desc" }, select: { userId: true, accessLevel: true, grantedAt: true, grantedBy: true, expiresAt: true, notes: true } }),
      prisma.user.findMany({ orderBy: { username: "asc" }, select: { id: true, username: true, isAdmin: true } }),
      prisma.systemState.findUnique({ where: { key: "betaSponsorsCardHidden" }, select: { value: true } }),
    ]);
    return NextResponse.json({ serverAccessLevel: configuredServerBetaLevel(), sponsorsCardHidden: sponsorsState?.value === "true", definitions: featureFlagRegistry.map((definition) => ({ ...definition, runtimeSupported: isFeatureImplemented(definition.key) })), overrides, access, users });
  } catch (error) { return betaApiError(error); }
}

export async function PUT(request: Request) {
  const actorId = cookies().get("mixarr_session")?.value;
  try {
    await requireAdminUser(actorId);
    const body = await request.json();
    if (body.action === "feature") {
      if (!featureFlagRegistry.some((definition) => definition.key === body.featureKey)) return NextResponse.json({ error: "UNKNOWN_FEATURE" }, { status: 400 });
      if (!isFeatureImplemented(body.featureKey) && (body.enabled !== false || body.forceDisabled === true)) return NextResponse.json({ error: "FEATURE_NOT_IMPLEMENTED" }, { status: 400 });
      const row = await prisma.featureFlagOverride.upsert({ where: { featureKey: body.featureKey }, update: { enabled: body.enabled !== false, forceDisabled: body.forceDisabled === true, userSelectable: body.userSelectable !== false, updatedBy: actorId }, create: { featureKey: body.featureKey, enabled: body.enabled !== false, forceDisabled: body.forceDisabled === true, userSelectable: body.userSelectable !== false, updatedBy: actorId } });
      console.info("[FeatureFlag] Administrator override updated", { feature: body.featureKey, enabled: row.enabled, forceDisabled: row.forceDisabled, updatedBy: actorId });
      return NextResponse.json(row);
    }
    if (body.action === "access") {
      const target = await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true } });
      if (!target) return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
      const level = normalizeBetaAccessLevel(body.accessLevel);
      if (level === "DEVELOPER" && configuredServerBetaLevel() !== "DEVELOPER") return NextResponse.json({ error: "DEVELOPER_ACCESS_SERVER_DISABLED" }, { status: 400 });
      const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
      const row = await prisma.userBetaAccess.upsert({ where: { userId: body.userId }, update: { accessLevel: level, grantedAt: level === "STABLE" ? null : new Date(), grantedBy: actorId, expiresAt, notes: typeof body.notes === "string" ? body.notes.slice(0, 500) : null }, create: { userId: body.userId, accessLevel: level, grantedAt: level === "STABLE" ? null : new Date(), grantedBy: actorId, expiresAt, notes: typeof body.notes === "string" ? body.notes.slice(0, 500) : null } });
      console.info(`[BetaAccess] ${level === "STABLE" ? "Private beta access revoked" : "Beta access granted"}`, { userId: body.userId, accessLevel: level, changedBy: actorId });
      return NextResponse.json({ userId: row.userId, accessLevel: row.accessLevel, grantedAt: row.grantedAt, expiresAt: row.expiresAt });
    }
    if (body.action === "sponsors") {
      const row = await prisma.systemState.upsert({ where: { key: "betaSponsorsCardHidden" }, update: { value: body.hidden === true ? "true" : "false" }, create: { key: "betaSponsorsCardHidden", value: body.hidden === true ? "true" : "false" } });
      return NextResponse.json({ hidden: row.value === "true" });
    }
    return NextResponse.json({ error: "UNKNOWN_ACTION" }, { status: 400 });
  } catch (error) { return betaApiError(error); }
}
