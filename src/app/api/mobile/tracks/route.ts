import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { decideFromFormat } from "@/lib/mobile/directPlay";
import { pagedResponse, parsePagination, requireMobileUser, runMobileRoute, serializeTrack } from "@/lib/mobile/api";

export const dynamic = "force-dynamic";

/** Paginated, searchable songs list for the authenticated user. */
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
      prisma.track.findMany({
        where,
        orderBy: { title: "asc" },
        skip,
        take,
        include: { album: { include: { artist: { select: { title: true } } } }, artist: { select: { title: true, thumb: true } } },
      }),
      prisma.track.count({ where }),
    ]);

    return NextResponse.json(
      pagedResponse(rows.map((track) => serializeTrack(track, decideFromFormat(track.fileFormat))), page, pageSize, total),
    );
  });
}
