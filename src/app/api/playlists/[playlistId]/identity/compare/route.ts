import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "Two snapshot IDs are required" }, { status: 400 });
  const snapshots = await prisma.playlistIdentitySnapshot.findMany({ where: { id: { in: [from, to] }, playlistIdentity: { playlistId: params.playlistId, userId } } });
  if (snapshots.length !== 2) return NextResponse.json({ error: "Identity snapshot not found" }, { status: 404 });
  const left = snapshots.find((item) => item.id === from)!;
  const right = snapshots.find((item) => item.id === to)!;
  const keys = Array.from(new Set([...Object.keys(left.profileJson as any), ...Object.keys(right.profileJson as any)]));
  const changes = keys.filter((key) => JSON.stringify((left.profileJson as any)[key]) !== JSON.stringify((right.profileJson as any)[key])).map((key) => ({ key, before: (left.profileJson as any)[key], after: (right.profileJson as any)[key] }));
  return NextResponse.json({ from: left, to: right, changes, changeCount: changes.length });
}
