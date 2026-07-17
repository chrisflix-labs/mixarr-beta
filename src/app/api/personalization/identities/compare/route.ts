import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url); const leftId = url.searchParams.get("left"); const rightId = url.searchParams.get("right");
  if (!leftId || !rightId || leftId === rightId) return NextResponse.json({ error: "Choose two different playlist identities." }, { status: 400 });
  const identities = await prisma.playlistIdentity.findMany({ where: { userId, id: { in: [leftId, rightId] } }, select: { id: true, displayName: true, confidence: true, effectiveProfileJson: true, historicalTrackCount: true, currentTrackCount: true, updatedAt: true } });
  if (identities.length !== 2) return NextResponse.json({ error: "Playlist identity not found" }, { status: 404 });
  const left = identities.find((item) => item.id === leftId)!; const right = identities.find((item) => item.id === rightId)!;
  const leftProfile = left.effectiveProfileJson && typeof left.effectiveProfileJson === "object" ? left.effectiveProfileJson as Record<string, unknown> : {}; const rightProfile = right.effectiveProfileJson && typeof right.effectiveProfileJson === "object" ? right.effectiveProfileJson as Record<string, unknown> : {};
  const keys = Array.from(new Set([...Object.keys(leftProfile), ...Object.keys(rightProfile)])).sort();
  const differences = keys.filter((key) => JSON.stringify(leftProfile[key]) !== JSON.stringify(rightProfile[key])).map((key) => ({ key, left: leftProfile[key] ?? null, right: rightProfile[key] ?? null }));
  return NextResponse.json({ left, right, differences, differenceCount: differences.length });
}
