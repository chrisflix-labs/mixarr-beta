import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdminUser } from "@/lib/auth";
import { betaApiError } from "@/lib/betaApi";

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  try {
    await requireAdminUser(userId);
    const [total, successful, fallbacks, failed, byFeature, recentErrors, betaPlaylists] = await Promise.all([
      prisma.betaFeatureUsage.count(), prisma.betaFeatureUsage.count({ where: { success: true } }), prisma.betaFeatureUsage.count({ where: { fallbackUsed: true } }), prisma.betaFeatureUsage.count({ where: { success: false } }),
      prisma.betaFeatureUsage.groupBy({ by: ["featureKey"], _count: { _all: true }, orderBy: { _count: { featureKey: "desc" } }, take: 10 }),
      prisma.betaFeatureUsage.findMany({ where: { success: false }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, featureKey: true, action: true, errorCode: true, createdAt: true } }),
      prisma.generatedPlaylist.count({ where: { betaMetadataJson: { not: { equals: null } } } }),
    ]);
    return NextResponse.json({ total, successful, fallbacks, failed, betaPlaylists, byFeature: byFeature.map((item) => ({ featureKey: item.featureKey, count: item._count._all })), recentErrors });
  } catch (error) { return betaApiError(error); }
}
