import { NextResponse } from "next/server";
import { checkPin, findReachableConnection, getServers, getUser } from "@/lib/plex";
import prisma from "@/lib/prisma";
import { sanitizeOptionalMetadataString, sanitizeRequiredMetadataString } from "@/lib/metadataSanitizer";
import { encryptSecret, isSecretEncryptionConfigured } from "@/lib/secretStorage";
import { createScopedToken } from "@/lib/integrations/service";
import { serializeUser } from "@/lib/mobile/api";

export const dynamic = "force-dynamic";

const TOKEN_TTL_DAYS = 30;

/**
 * Completes the Plex PIN flow for the mobile app. While the PIN is not yet
 * authorized returns `{ status: "pending" }`. On success it upserts the user,
 * discovers/saves their reachable Plex servers (mirroring the web login), then
 * mints a short-lived, read-only scoped bearer token for the app. No web
 * session cookie is set on this path.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const pinId = body?.pinId;
    const deviceName = typeof body?.deviceName === "string" ? body.deviceName.slice(0, 60) : "iPhone";

    if (!pinId) {
      return NextResponse.json({ error: { code: "MISSING_PIN", message: "Missing pinId." } }, { status: 400 });
    }

    const pin = await checkPin(pinId);
    if (!pin.authToken) {
      return NextResponse.json({ status: "pending" });
    }

    const plexUser = await getUser(pin.authToken);
    const username = sanitizeRequiredMetadataString(plexUser.username, { entity: "User", entityId: plexUser.id, field: "username" });
    const email = sanitizeOptionalMetadataString(plexUser.email, { entity: "User", entityId: plexUser.id, field: "email" });
    const thumb = sanitizeOptionalMetadataString(plexUser.thumb, { entity: "User", entityId: plexUser.id, field: "thumb" });

    const isFirstUser = (await prisma.user.count()) === 0;
    const user = await prisma.user.upsert({
      where: { plexId: plexUser.id },
      update: { username, email, thumb, accessToken: pin.authToken },
      create: { plexId: plexUser.id, username, email, thumb, accessToken: pin.authToken, isAdmin: isFirstUser },
    });

    // Discover and persist reachable Plex servers, exactly as the web login does.
    const plexServers = await getServers(pin.authToken);
    await Promise.all(
      plexServers.map(async (server) => {
        const result = await findReachableConnection(server.connections);
        if (!result.uri) return;
        const machineIdentifier = sanitizeRequiredMetadataString(server.clientIdentifier, { entity: "Server", entityId: server.clientIdentifier, field: "machineIdentifier" });
        const serverName = sanitizeRequiredMetadataString(server.name, { entity: "Server", entityId: server.clientIdentifier, field: "name" });
        const serverUri = sanitizeRequiredMetadataString(result.uri, { entity: "Server", entityId: server.clientIdentifier, field: "uri" });
        await prisma.server.upsert({
          where: { machineIdentifier },
          update: {
            name: serverName, uri: serverUri, accessToken: server.accessToken,
            accessTokenEncrypted: isSecretEncryptionConfigured() ? encryptSecret(server.accessToken) : undefined,
            userId: user.id,
          },
          create: {
            machineIdentifier, name: serverName, uri: serverUri, accessToken: server.accessToken,
            accessTokenEncrypted: isSecretEncryptionConfigured() ? encryptSecret(server.accessToken) : undefined,
            userId: user.id,
          },
        });
      }),
    );

    const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    const minted = await createScopedToken(user.id, {
      name: `Mixarr Mobile (${deviceName})`,
      description: "Mobile companion app token",
      scopes: ["library.read", "stream.read"],
      expiresAt: expiresAt.toISOString(),
    });

    console.log(`[Mobile][Auth] Login complete for ${user.username}; issued mobile token ${minted.prefix}…`);

    return NextResponse.json({
      status: "success",
      access_token: minted.token,
      token_type: "Bearer",
      expires_at: expiresAt.toISOString(),
      user: serializeUser(user),
    });
  } catch (error) {
    console.error("[Mobile][Auth] Plex poll error", error);
    return NextResponse.json({ error: { code: "AUTH_FAILED", message: "Authentication failed." } }, { status: 500 });
  }
}
