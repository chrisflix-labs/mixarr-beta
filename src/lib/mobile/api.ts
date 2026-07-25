import { NextResponse } from "next/server";
import { authorizeApiRequest, IntegrationError } from "@/lib/integrations/service";
import type { ApiTokenScope } from "@/lib/integrations/core";

/** Standard JSON error envelope for the mobile API. */
export function mobileError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * Authorizes a mobile bearer token for the required scope. Returns the userId
 * on success; on failure throws a Response the route can return directly.
 */
export async function requireMobileUser(request: Request, scope: ApiTokenScope): Promise<{ userId: string; tokenId: string }> {
  try {
    const result = await authorizeApiRequest(request, scope);
    return { userId: result.userId, tokenId: result.tokenId };
  } catch (error) {
    if (error instanceof IntegrationError) {
      throw mobileError(error.status, error.code, error.message);
    }
    throw mobileError(500, "AUTH_FAILED", "Authorization failed.");
  }
}

/** Runs a mobile route handler, converting thrown Responses/errors to JSON. */
export async function runMobileRoute(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof IntegrationError) return mobileError(error.status, error.code, error.message);
    console.error("[Mobile] Unhandled route error", error);
    return mobileError(500, "UNKNOWN", "An unexpected error occurred.");
  }
}

export interface Pagination {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export function parsePagination(searchParams: URLSearchParams, defaultSize = 50, maxSize = 200): Pagination {
  const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1);
  const requested = Number.parseInt(searchParams.get("pageSize") || String(defaultSize), 10) || defaultSize;
  const pageSize = Math.min(maxSize, Math.max(1, requested));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function pagedResponse<T>(items: T[], page: number, pageSize: number, total: number) {
  return {
    items,
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
  };
}

// ---------------------------------------------------------------------------
// Serializers — map Prisma rows to the stable mobile JSON contract. Artwork is
// always returned as a mobile proxy path (never a raw Plex path/token), and
// durations are returned in seconds.
// ---------------------------------------------------------------------------

export function artworkPath(type: "artist" | "album", id: string, thumb: string | null | undefined): string | null {
  if (!thumb) return null;
  return `/api/mobile/artwork?type=${type}&id=${encodeURIComponent(id)}`;
}

function msToSeconds(ms: number | null | undefined): number | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return null;
  return Math.round((ms / 1000) * 1000) / 1000;
}

function discNumberFrom(track: any): number | null {
  const parentIndex = track?.plexMetadata?.parentIndex;
  const value = Number(parentIndex);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function serializeUser(user: any) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.username,
    email: user.email ?? null,
    avatarURL: user.thumb ?? null,
  };
}

export function serializeArtist(artist: any) {
  return {
    id: artist.id,
    name: artist.title,
    sortName: artist.title,
    artworkURL: artworkPath("artist", artist.id, artist.thumb),
    albumCount: typeof artist._count?.albums === "number" ? artist._count.albums : null,
    trackCount: typeof artist._count?.tracks === "number" ? artist._count.tracks : null,
  };
}

export function serializeAlbum(album: any) {
  return {
    id: album.id,
    title: album.title,
    artistId: album.artistId,
    artistName: album.artist?.title ?? null,
    year: album.year ?? null,
    artworkURL: artworkPath("album", album.id, album.thumb),
    trackCount: typeof album._count?.tracks === "number" ? album._count.tracks : (album.plexTrackCount ?? null),
    duration: null as number | null,
    discCount: null as number | null,
  };
}

export function serializeTrack(track: any, decision: { canDirectPlay: boolean }) {
  const album = track.album || null;
  const artist = track.artist || null;
  return {
    id: track.id,
    title: track.title,
    artistId: track.artistId,
    artistName: artist?.title ?? null,
    albumId: track.albumId,
    albumTitle: album?.title ?? null,
    albumArtist: album?.artist?.title ?? artist?.title ?? null,
    trackNumber: track.trackIndex ?? null,
    discNumber: discNumberFrom(track),
    duration: msToSeconds(track.duration),
    artworkURL: album ? artworkPath("album", album.id, album.thumb) : artworkPath("artist", track.artistId, artist?.thumb),
    // audioURL is intentionally null in browse payloads; the client obtains a
    // short-lived signed stream URL via the playback-token endpoint.
    audioURL: null as string | null,
    mimeType: null as string | null,
    codec: track.fileFormat ?? null,
    bitrate: track.bitrate ?? null,
    sampleRate: null as number | null,
    bitDepth: null as number | null,
    channels: null as number | null,
    fileSize: track.fileSize !== null && track.fileSize !== undefined ? String(track.fileSize) : null,
    canDirectPlay: decision.canDirectPlay,
  };
}

export function serializePlaylistSummary(playlist: any) {
  return {
    id: playlist.id,
    name: playlist.plexPlaylistTitle,
    description: playlist.localPlaylistNotes ?? null,
    artworkURL: null as string | null,
    trackCount: playlist.trackCount ?? (typeof playlist._count?.tracks === "number" ? playlist._count.tracks : null),
    duration: null as number | null,
    ownerName: playlist.plexOwnerName ?? null,
  };
}
