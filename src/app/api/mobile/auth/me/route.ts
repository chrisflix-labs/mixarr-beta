import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { mobileError, requireMobileUser, runMobileRoute, serializeUser } from "@/lib/mobile/api";

export const dynamic = "force-dynamic";

/** Returns the authenticated user's profile. Used to restore the session. */
export async function GET(req: Request) {
  return runMobileRoute(async () => {
    const { userId } = await requireMobileUser(req, "library.read");
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return mobileError(404, "USER_NOT_FOUND", "User not found.");
    return NextResponse.json({ user: serializeUser(user) });
  });
}
