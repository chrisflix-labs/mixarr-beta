import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { serverAccessToken } from "@/lib/integrations/service";
import { decideFromPart, fetchPlexPartInfo } from "@/lib/mobile/directPlay";
import { createStreamToken } from "@/lib/mobile/streamToken";
import { mobileError, requireMobileUser, runMobileRoute } from "@/lib/mobile/api";

export const dynamic = "force-dynamic";

/**
 * Issues a short-lived, signed Direct Play URL for a track. Reads live Plex
 * media metadata to decide Direct Play from the real codec/container (never a
 * filename extension) and returns the technical details for the Now Playing
 * readout. When the format is not natively playable it returns
 * `playback_mode: "unsupported"` with a reason — the app shows a clear message
 * and never attempts to transcode.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return runMobileRoute(async () => {
    const { userId } = await requireMobileUser(req, "stream.read");

    const track = await prisma.track.findFirst({
      where: { id: params.id, library: { server: { userId } } },
      include: { library: { include: { server: true } } },
    });
    if (!track) return mobileError(404, "NOT_FOUND", "Track not found.");

    const server = track.library.server;
    const ratingKey = track.ratingKey || track.plexId;
    const part = await fetchPlexPartInfo(server.uri, ratingKey, serverAccessToken(server));

    if (!part || !part.partKey) {
      return NextResponse.json({
        track_id: track.id,
        playback_mode: "unsupported",
        reason: "No playable media was found for this track on the Plex server.",
      });
    }

    const decision = decideFromPart(part);
    if (!decision.canDirectPlay) {
      return NextResponse.json({
        track_id: track.id,
        playback_mode: "unsupported",
        reason: decision.reason,
        mime_type: part.mimeType,
        codec: part.codec,
      });
    }

    const { token, expiresAt } = createStreamToken(track.id, userId);
    const origin = new URL(req.url).origin;

    return NextResponse.json({
      track_id: track.id,
      playback_url: `${origin}/api/mobile/tracks/${track.id}/stream?token=${encodeURIComponent(token)}`,
      expires_at: expiresAt,
      playback_mode: "direct_play",
      mime_type: part.mimeType,
      codec: part.codec,
      bitrate: part.bitrate,
      sample_rate: part.sampleRate,
      bit_depth: part.bitDepth,
      channels: part.channels,
    });
  });
}
