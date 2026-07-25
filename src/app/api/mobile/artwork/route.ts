import prisma from "@/lib/prisma";
import { serverAccessToken } from "@/lib/integrations/service";
import { mobileError, requireMobileUser, runMobileRoute } from "@/lib/mobile/api";

export const dynamic = "force-dynamic";

/**
 * Proxies Plex artwork so the app never receives the server's X-Plex-Token.
 * `type` is "album" or "artist"; `id` is the Mixarr row id. Ownership-scoped.
 */
export async function GET(req: Request) {
  return runMobileRoute(async () => {
    const { userId } = await requireMobileUser(req, "library.read");
    const url = new URL(req.url);
    const type = url.searchParams.get("type");
    const id = url.searchParams.get("id");
    if (!id || (type !== "album" && type !== "artist")) {
      return mobileError(400, "BAD_REQUEST", "A valid artwork type and id are required.");
    }

    const include = { library: { include: { server: true } } } as const;
    const row =
      type === "album"
        ? await prisma.album.findFirst({ where: { id, library: { server: { userId } } }, include })
        : await prisma.artist.findFirst({ where: { id, library: { server: { userId } } }, include });

    if (!row || !row.thumb) return mobileError(404, "NOT_FOUND", "Artwork not found.");

    const server = row.library.server;
    const base = server.uri.endsWith("/") ? server.uri : `${server.uri}/`;
    const thumb = row.thumb.startsWith("/") ? row.thumb.slice(1) : row.thumb;
    const plexUrl = new URL(thumb, base);

    const upstream = await fetch(plexUrl, {
      headers: {
        "X-Plex-Token": serverAccessToken(server),
        "X-Plex-Client-Identifier": (process.env.PLEX_CLIENT_IDENTIFIER || "mixarr").trim(),
      },
      cache: "no-store",
    });
    if (!upstream.ok || !upstream.body) return mobileError(502, "ARTWORK_UNAVAILABLE", "Unable to load artwork.");

    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("content-type") || "image/jpeg");
    const length = upstream.headers.get("content-length");
    if (length) headers.set("Content-Length", length);
    headers.set("Cache-Control", "private, max-age=86400");

    return new Response(upstream.body, { status: 200, headers });
  });
}
