import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { pagedResponse, parsePagination, requireMobileUser, runMobileRoute, serializeArtist } from "@/lib/mobile/api";

export const dynamic = "force-dynamic";

/** Paginated, alphabetically-sorted artists for the authenticated user. */
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
      prisma.artist.findMany({
        where,
        orderBy: { title: "asc" },
        skip,
        take,
        include: { _count: { select: { albums: true, tracks: true } } },
      }),
      prisma.artist.count({ where }),
    ]);

    return NextResponse.json(pagedResponse(rows.map(serializeArtist), page, pageSize, total));
  });
}
