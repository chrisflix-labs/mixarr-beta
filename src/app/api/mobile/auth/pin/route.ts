import { NextResponse } from "next/server";
import { requestPin } from "@/lib/plex";

export const dynamic = "force-dynamic";

/**
 * Starts the Plex OAuth PIN flow for the mobile app. The app opens `authUrl`
 * in a system browser, then polls /api/mobile/auth/poll with `pinId`.
 */
export async function GET() {
  try {
    const pin = await requestPin();
    const clientIdentifier = (process.env.PLEX_CLIENT_IDENTIFIER || "mixarr-default-client").trim();
    const product = (process.env.PLEX_PRODUCT_NAME || "Mixarr").trim();
    const authUrl = `https://app.plex.tv/auth#?clientID=${clientIdentifier}&code=${pin.code}&context[device][product]=${product}`;

    return NextResponse.json({ pinId: pin.id, code: pin.code, authUrl });
  } catch (error) {
    console.error("[Mobile][Auth] Failed to request Plex PIN", error);
    return NextResponse.json({ error: { code: "PLEX_PIN_FAILED", message: "Failed to request a Plex sign-in code." } }, { status: 502 });
  }
}
