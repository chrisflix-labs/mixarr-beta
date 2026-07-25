import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { serverAccessToken } from "@/lib/integrations/service";
import { fetchPlexPartInfo } from "@/lib/mobile/directPlay";
import { verifyStreamToken } from "@/lib/mobile/streamToken";

export const dynamic = "force-dynamic";

function plexHeaders(accessToken: string, range?: string | null) {
  return {
    Accept: "*/*",
    "X-Plex-Token": accessToken,
    "X-Plex-Client-Identifier": (process.env.PLEX_CLIENT_IDENTIFIER || "mixarr").trim(),
    ...(range ? { Range: range } : {}),
  };
}

function copyHeader(source: Headers, target: Headers, name: string) {
  const value = source.get(name);
  if (value) target.set(name, value);
}

/**
 * Direct Play stream: authenticated by a short-lived signed token (so AVPlayer
 * can fetch it directly, without the bearer credential). Proxies the ORIGINAL
 * Plex file part with HTTP Range forwarding for seeking. Never transcodes.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const url = new URL(req.url);
  const claims = verifyStreamToken(url.searchParams.get("token"), params.id);
  if (!claims) {
    return NextResponse.json({ error: { code: "INVALID_TOKEN", message: "The playback token is invalid or expired." } }, { status: 401 });
  }

  const track = await prisma.track.findFirst({
    where: { id: params.id, library: { server: { userId: claims.userId } } },
    include: { library: { include: { server: true } } },
  });
  if (!track) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Track not found." } }, { status: 404 });
  }

  const server = track.library.server;
  const accessToken = serverAccessToken(server);
  const ratingKey = track.ratingKey || track.plexId;
  const part = await fetchPlexPartInfo(server.uri, ratingKey, accessToken);
  if (!part?.partKey) {
    return NextResponse.json({ error: { code: "NO_MEDIA", message: "No playable media part found." } }, { status: 404 });
  }

  const base = server.uri.endsWith("/") ? server.uri : `${server.uri}/`;
  const partKey = part.partKey.startsWith("/") ? part.partKey.slice(1) : part.partKey;
  const mediaUrl = new URL(partKey, base);
  const range = req.headers.get("range");

  const upstream = await fetch(mediaUrl, { headers: plexHeaders(accessToken, range), cache: "no-store" });
  if (!upstream.ok && upstream.status !== 206) {
    return NextResponse.json({ error: { code: "STREAM_FAILED", message: "Unable to stream this track." } }, { status: 502 });
  }

  const headers = new Headers();
  copyHeader(upstream.headers, headers, "content-type");
  copyHeader(upstream.headers, headers, "content-length");
  copyHeader(upstream.headers, headers, "content-range");
  copyHeader(upstream.headers, headers, "accept-ranges");
  if (!headers.has("content-type") && part.mimeType) headers.set("content-type", part.mimeType);
  if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");
  headers.set("Cache-Control", "private, max-age=300");

  return new Response(upstream.body, { status: upstream.status, headers });
}
