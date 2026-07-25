import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireMobileUser, runMobileRoute } from "@/lib/mobile/api";

export const dynamic = "force-dynamic";

/** Revokes the calling mobile token so it can no longer be used. */
export async function POST(req: Request) {
  return runMobileRoute(async () => {
    const { tokenId } = await requireMobileUser(req, "library.read");
    await prisma.apiToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date(), enabled: false },
    });
    return NextResponse.json({ status: "signed_out" });
  });
}
