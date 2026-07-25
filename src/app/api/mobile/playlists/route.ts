import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { pagedResponse, parsePagination, requireMobileUser, runMobileRoute, serializePlaylistSummary } from "@/lib/mobile/api";

export const dynamic = "force-dynamic";

/** Paginated list of the user's Mixarr / Plex playlists (read-only in v0.1.0). */
export async function GET(req: Request) {
  return runMobileRoute(async () => {
    const { userId } = await requireMobileUser(req, "library.read");
    const url = new URL(req.url);
    const { page, pageSize, skip, take } = parsePagination(url.searchParams);

    const where = { userId };
    const [rows, total] = await Promise.all([
      prisma.generatedPlaylist.findMany({ where, orderBy: { lastGeneratedAt: "desc" }, skip, take }),
      prisma.generatedPlaylist.count({ where }),
    ]);

    return NextResponse.json(pagedResponse(rows.map(serializePlaylistSummary), page, pageSize, total));
  });
}
