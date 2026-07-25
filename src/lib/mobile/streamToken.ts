import crypto from "crypto";

/**
 * Short-lived, HMAC-signed playback tokens for the mobile app's Direct Play
 * stream endpoint. These are deliberately separate from the API bearer token:
 * they are embedded in the stream URL that `AVPlayer` fetches directly, so they
 * must not carry the long-lived credential. Each token is bound to a single
 * track + user and expires within minutes.
 *
 * The signing key is derived from MIXARR_SECRET_KEY when configured (stable
 * across instances/restarts); otherwise a per-process random key is used, which
 * is sufficient because the tokens live only a few minutes.
 */

const DEFAULT_TTL_SECONDS = 5 * 60;

let ephemeralKey: Buffer | null = null;

function signingKey(): Buffer {
  const configured = (process.env.MIXARR_SECRET_KEY || "").trim();
  if (configured) {
    return crypto.createHash("sha256").update(`${configured}:mobile-stream-token`).digest();
  }
  if (!ephemeralKey) ephemeralKey = crypto.randomBytes(32);
  return ephemeralKey;
}

export interface StreamTokenClaims {
  trackId: string;
  userId: string;
  /** Unix epoch seconds. */
  exp: number;
}

function encode(payload: object): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function sign(data: string): string {
  return crypto.createHmac("sha256", signingKey()).update(data).digest("base64url");
}

export function createStreamToken(
  trackId: string,
  userId: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): { token: string; expiresAt: string } {
  const exp = Math.floor(Date.now() / 1000) + Math.max(30, ttlSeconds);
  const body = encode({ trackId, userId, exp } satisfies StreamTokenClaims);
  const token = `${body}.${sign(body)}`;
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}

/**
 * Verifies signature, expiry, and that the token is bound to the expected
 * track. Returns the claims when valid, otherwise null. Uses a constant-time
 * signature comparison.
 */
export function verifyStreamToken(token: string | null | undefined, expectedTrackId: string): StreamTokenClaims | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = sign(body);
  const provided = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (provided.length !== expectedBuffer.length || !crypto.timingSafeEqual(provided, expectedBuffer)) {
    return null;
  }

  let claims: StreamTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!claims.trackId || !claims.userId || typeof claims.exp !== "number") return null;
  if (claims.trackId !== expectedTrackId) return null;
  if (claims.exp * 1000 <= Date.now()) return null;

  return claims;
}
