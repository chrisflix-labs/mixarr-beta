import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { pagedResponse, parsePagination, requireMobileUser, runMobileRoute, serializeAlbum } from "@/lib/mobile/api";

export const dynamic = "force-dynamic";

/** Paginated albums for the authenticated user. */
export async function GET(req: Request) {
  return runMobileRoute(async () => {
    const { userId } = await requireMobileUser(req, "library.read");
    const url = new URL(req.url);
    const { page, pageSize, skip, take } = parsePagination(url.searchParams);
    const search = url.searchParams.get("search")?.trim();

    const where = {
      syncStatus: "active",
      library: { server: { userId } },
      ...(search ? { title: { contains: search, mode: "insensitive" as const } } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.album.findMany({
        where,
        orderBy: { title: "asc" },
        skip,
        take,
        include: { artist: { select: { title: true } }, _count: { select: { tracks: true } } },
      }),
      prisma.album.count({ where }),
    ]);

    return NextResponse.json(pagedResponse(rows.map(serializeAlbum), page, pageSize, total));
  });
}
