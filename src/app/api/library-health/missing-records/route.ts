import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  if (!kind || !["tracks", "albums", "artists"].includes(kind)) return NextResponse.json({ error: "kind must be tracks, albums, or artists" }, { status: 400 });
  const libraryId = params.get("libraryId") || undefined;
  const search = params.get("search")?.trim() || undefined;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(params.get("pageSize")) || 50));
  const skip = (page - 1) * pageSize;

  if (kind === "tracks") {
    const where = { syncStatus: "missing", library: { ...(libraryId ? { id: libraryId } : {}), server: { userId } }, ...(search ? { OR: [{ title: { contains: search, mode: "insensitive" as const } }, { artist: { title: { contains: search, mode: "insensitive" as const } } }, { album: { title: { contains: search, mode: "insensitive" as const } } }] } : {}) };
    const [total, records] = await Promise.all([
      prisma.track.count({ where }),
      prisma.track.findMany({ where, skip, take: pageSize, orderBy: [{ missingSince: "desc" }, { title: "asc" }], select: { id: true, title: true, ratingKey: true, mediaPath: true, missingSince: true, lastSeenAt: true, syncConflictReason: true, library: { select: { id: true, name: true } }, artist: { select: { title: true } }, album: { select: { title: true } } } }),
    ]);
    return NextResponse.json({ kind, records, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } });
  }

  if (kind === "albums") {
    const where = { syncStatus: "missing", library: { ...(libraryId ? { id: libraryId } : {}), server: { userId } }, ...(search ? { OR: [{ title: { contains: search, mode: "insensitive" as const } }, { artist: { title: { contains: search, mode: "insensitive" as const } } }] } : {}) };
    const [total, albums] = await Promise.all([
      prisma.album.count({ where }),
      prisma.album.findMany({ where, skip, take: pageSize, orderBy: [{ missingSince: "desc" }, { title: "asc" }], include: { library: { select: { id: true, name: true } }, artist: { select: { title: true } }, tracks: { take: 12, orderBy: { trackIndex: "asc" }, select: { id: true, syncStatus: true, mediaPath: true, ratingKey: true } }, _count: { select: { tracks: true } } } }),
    ]);
    const albumIds = albums.map((album) => album.id);
    const activeCounts = albumIds.length ? await prisma.track.groupBy({ by: ["albumId"], where: { albumId: { in: albumIds }, syncStatus: "active" }, _count: { _all: true } }) : [];
    const unresolved = albumIds.length ? await prisma.plexSyncConflict.findMany({ where: { resolutionStatus: "unresolved", track: { is: { albumId: { in: albumIds } } } }, select: { track: { select: { albumId: true } } } }) : [];
    const activeMap = new Map(activeCounts.map((entry) => [entry.albumId, entry._count._all]));
    const unresolvedMap = new Map<string, number>(); for (const row of unresolved) if (row.track) unresolvedMap.set(row.track.albumId, (unresolvedMap.get(row.track.albumId) || 0) + 1);
    const records = albums.map((album) => { const expectedTrackCount = album.plexTrackCount ?? album._count.tracks; const activeMixarrTrackCount = activeMap.get(album.id) || 0; return { ...album, expectedTrackCount, activeMixarrTrackCount, missingTrackCount: Math.max(0, expectedTrackCount - activeMixarrTrackCount), unresolvedTrackCount: unresolvedMap.get(album.id) || 0, filePaths: album.tracks.map((track) => track.mediaPath).filter(Boolean), reason: "No active Mixarr tracks currently reference this Plex album." }; });
    return NextResponse.json({ kind, records, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } });
  }

  const where = { syncStatus: "missing", library: { ...(libraryId ? { id: libraryId } : {}), server: { userId } }, ...(search ? { title: { contains: search, mode: "insensitive" as const } } : {}) };
  const [total, artists] = await Promise.all([
    prisma.artist.count({ where }),
    prisma.artist.findMany({ where, skip, take: pageSize, orderBy: [{ missingSince: "desc" }, { title: "asc" }], include: { library: { select: { id: true, name: true } }, tracks: { take: 12, select: { id: true, syncStatus: true, mediaPath: true } }, _count: { select: { tracks: true, albums: true } } } }),
  ]);
  const artistIds = artists.map((artist) => artist.id);
  const activeCounts = artistIds.length ? await prisma.track.groupBy({ by: ["artistId"], where: { artistId: { in: artistIds }, syncStatus: "active" }, _count: { _all: true } }) : [];
  const activeMap = new Map(activeCounts.map((entry) => [entry.artistId, entry._count._all]));
  const records = artists.map((artist) => ({ ...artist, expectedTrackCount: artist._count.tracks, activeMixarrTrackCount: activeMap.get(artist.id) || 0, missingTrackCount: artist._count.tracks - (activeMap.get(artist.id) || 0), filePaths: artist.tracks.map((track) => track.mediaPath).filter(Boolean), reason: "No active Mixarr albums or tracks currently reference this Plex artist." }));
  return NextResponse.json({ kind, records, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } });
}
