import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { decideFromFormat } from "@/lib/mobile/directPlay";
import { mobileError, requireMobileUser, runMobileRoute, serializePlaylistSummary, serializeTrack } from "@/lib/mobile/api";

export const dynamic = "force-dynamic";

/** A playlist entry whose DB track could not be resolved (e.g. Plex-only). It
 * is shown but not directly playable (no valid track id for a playback token). */
function unresolvedItem(entry: any) {
  return {
    id: `unresolved:${entry.id}`,
    title: entry.title,
    artistId: null,
    artistName: entry.artist ?? null,
    albumId: null,
    albumTitle: entry.album ?? null,
    albumArtist: entry.artist ?? null,
    trackNumber: entry.position ?? null,
    discNumber: null,
    duration: null,
    artworkURL: null,
    audioURL: null,
    mimeType: null,
    codec: null,
    bitrate: null,
    sampleRate: null,
    bitDepth: null,
    channels: null,
    fileSize: null,
    canDirectPlay: false,
  };
}

/** Playlist detail with an ordered track list (read-only in v0.1.0). */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return runMobileRoute(async () => {
    const { userId } = await requireMobileUser(req, "library.read");

    const playlist = await prisma.generatedPlaylist.findFirst({
      where: { id: params.id, userId },
      include: { tracks: { orderBy: { position: "asc" } } },
    });
    if (!playlist) return mobileError(404, "NOT_FOUND", "Playlist not found.");

    const trackIds = playlist.tracks.map((entry) => entry.trackId).filter((id): id is string => !!id);
    const dbTracks = trackIds.length
      ? await prisma.track.findMany({
          where: { id: { in: trackIds }, syncStatus: "active", library: { server: { userId } } },
          include: { album: { include: { artist: { select: { title: true } } } }, artist: { select: { title: true, thumb: true } } },
        })
      : [];
    const byId = new Map(dbTracks.map((track) => [track.id, track]));

    let totalMs = 0;
    const tracks = playlist.tracks.map((entry) => {
      const track = entry.trackId ? byId.get(entry.trackId) : undefined;
      if (!track) return unresolvedItem(entry);
      totalMs += track.duration ?? 0;
      return serializeTrack(track, decideFromFormat(track.fileFormat));
    });

    return NextResponse.json({
      ...serializePlaylistSummary(playlist),
      trackCount: tracks.length,
      duration: totalMs > 0 ? Math.round(totalMs / 1000) : null,
      tracks,
    });
  });
}
