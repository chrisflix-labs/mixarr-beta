import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const identity = await prisma.playlistIdentity.findFirst({ where: { playlistId: params.playlistId, userId }, select: { id: true } });
  if (!identity) return NextResponse.json({ error: "Playlist identity not found" }, { status: 404 });
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 25));
  const kind = url.searchParams.get("kind") || "events";
  const skip = (page - 1) * pageSize;
  if (kind === "training") {
    const [items, total] = await Promise.all([prisma.playlistIdentityTrainingRun.findMany({ where: { playlistIdentityId: identity.id }, orderBy: { startedAt: "desc" }, skip, take: pageSize }), prisma.playlistIdentityTrainingRun.count({ where: { playlistIdentityId: identity.id } })]);
    return NextResponse.json({ kind, items, total, page, pageSize });
  }
  if (kind === "snapshots") {
    const [items, total] = await Promise.all([prisma.playlistIdentitySnapshot.findMany({ where: { playlistIdentityId: identity.id }, orderBy: { createdAt: "desc" }, skip, take: pageSize }), prisma.playlistIdentitySnapshot.count({ where: { playlistIdentityId: identity.id } })]);
    return NextResponse.json({ kind, items, total, page, pageSize });
  }
  const [items, total] = await Promise.all([
    prisma.playlistMembershipEvent.findMany({ where: { playlistIdentityId: identity.id }, include: { track: { select: { title: true, artist: { select: { title: true } } } } }, orderBy: { occurredAt: "desc" }, skip, take: pageSize }),
    prisma.playlistMembershipEvent.count({ where: { playlistIdentityId: identity.id } }),
  ]);
  return NextResponse.json({ kind: "events", items, total, page, pageSize });
}
