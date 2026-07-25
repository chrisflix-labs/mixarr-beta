import { NextResponse } from "next/server";
import { APP_NAME } from "@/lib/appInfo";
import { APP_VERSION_NUMBER } from "@/lib/appVersion";

export const dynamic = "force-dynamic";

/**
 * Unauthenticated identity/health endpoint. The mobile "Test Connection" action
 * hits this to confirm it is talking to a compatible Mixarr server and to show
 * the detected version before the user signs in.
 */
export async function GET() {
  return NextResponse.json({
    name: APP_NAME,
    version: APP_VERSION_NUMBER,
    apiVersion: "mobile-v1",
    serverIdentifier: (process.env.PLEX_CLIENT_IDENTIFIER || "mixarr").trim(),
    capabilities: ["plex_pin_auth", "browse", "direct_play", "artwork_proxy"],
  });
}
