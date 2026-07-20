import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";

export async function GET() {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const servers = await prisma.server.findMany({
      where: { userId },
      select: {
        id: true, machineIdentifier: true, name: true, uri: true, userId: true,
        priority: true, enabled: true, role: true, availabilityState: true,
        failureCount: true, lastSuccessAt: true, lastFailureAt: true,
        lastFailureReason: true, responseLatencyMs: true, automaticFailover: true,
        minimumFailures: true, failoverCooldownMinutes: true, failoverWritePolicy: true,
        createdAt: true, updatedAt: true,
        libraries: {
          select: {
            id: true, plexId: true, serverId: true, name: true, type: true,
            scanState: true, lastScanDetectedAt: true, lastScanCompletedAt: true,
            destructiveSyncBlockedUntil: true, createdAt: true, updatedAt: true,
            _count: { select: { tracks: { where: { syncStatus: "active" } } } },
            syncLogs: {
              orderBy: { startedAt: "desc" },
              take: 1,
              select: { status: true, startedAt: true, endedAt: true },
            },
          },
        },
      },
    });

    return NextResponse.json({ servers });
  } catch (error) {
    console.error("Failed to fetch servers", error);
    return NextResponse.json({ error: "Failed to fetch servers" }, { status: 500 });
  }
}
