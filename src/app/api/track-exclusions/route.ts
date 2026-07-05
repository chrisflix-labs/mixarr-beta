import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { findOwnedTrackForExclusion, normalizeExclusionReason } from "@/lib/trackExclusions";

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const exclusions = await prisma.trackExclusion.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      track: {
        select: {
          id: true,
          title: true,
          artist: { select: { title: true } },
          album: { select: { title: true } },
        },
      },
    },
  });

  return NextResponse.json({
    exclusions: exclusions.map((exclusion) => ({
      id: exclusion.id,
      trackId: exclusion.trackId,
      reason: exclusion.reason,
      notes: exclusion.notes,
      source: exclusion.source,
      createdAt: exclusion.createdAt,
      updatedAt: exclusion.updatedAt,
      track: exclusion.track,
    })),
  });
}

export async function POST(req: Request) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const trackId = typeof body.trackId === "string" ? body.trackId.trim() : "";
    const reason = normalizeExclusionReason(body.reason);

    if (!trackId) {
      return NextResponse.json({ error: "Track is required" }, { status: 400 });
    }

    const track = await findOwnedTrackForExclusion(userId, trackId);
    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }

    const existing = await prisma.trackExclusion.findUnique({
      where: { trackId: track.id },
      include: {
        track: {
          select: {
            id: true,
            title: true,
            artist: { select: { title: true } },
            album: { select: { title: true } },
          },
        },
      },
    });

    if (existing) {
      return NextResponse.json({
        excluded: true,
        alreadyExcluded: true,
        exclusion: existing,
      });
    }

    const exclusion = await prisma.trackExclusion.create({
      data: {
        userId,
        trackId: track.id,
        reason,
        source: "manual",
        createdBy: userId,
      },
      include: {
        track: {
          select: {
            id: true,
            title: true,
            artist: { select: { title: true } },
            album: { select: { title: true } },
          },
        },
      },
    });

    return NextResponse.json({ excluded: true, alreadyExcluded: false, exclusion });
  } catch (error: any) {
    console.error("Track exclusion failed:", error);
    return NextResponse.json({ error: "Failed to exclude track" }, { status: 500 });
  }
}
