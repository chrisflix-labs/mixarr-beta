import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(params.get("pageSize")) || 50));
  const libraryId = params.get("libraryId") || undefined;
  const search = params.get("search")?.trim() || undefined;
  const status = params.get("status") || undefined;
  const where = {
    library: { ...(libraryId ? { id: libraryId } : {}), server: { userId } },
    ...(status ? { reviewStatus: status } : {}),
    ...(search ? { OR: [
      { canonicalArtist: { contains: search, mode: "insensitive" as const } },
      { canonicalTitle: { contains: search, mode: "insensitive" as const } },
    ] } : {}),
  };
  const [total, groups] = await Promise.all([
    prisma.canonicalRecording.count({ where }),
    prisma.canonicalRecording.findMany({ where, orderBy: [{ updatedAt: "desc" }, { canonicalArtist: "asc" }], skip: (page - 1) * pageSize, take: pageSize, include: { library: { select: { id: true, name: true } }, _count: { select: { tracks: true } }, preferredEnrichmentTrack: { select: { id: true, title: true } } } }),
  ]);
  return NextResponse.json({ groups, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } });
}
