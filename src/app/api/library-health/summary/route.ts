import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { getLibraryHealthDetailSummary } from "@/lib/libraryHealthDetails";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const libraryId = params.get("libraryId") || undefined;

  try {
    const [summary, libraries] = await Promise.all([
      getLibraryHealthDetailSummary(userId, libraryId),
      prisma.library.findMany({
        where: { type: "artist", server: { userId } },
        select: { id: true, name: true, server: { select: { id: true, name: true } } },
        orderBy: [{ server: { name: "asc" } }, { name: "asc" }],
      }),
    ]);

    return NextResponse.json({ ...summary, libraries });
  } catch (error) {
    console.error("[LibraryHealthDetails] Failed to load summary", error);
    return NextResponse.json({ error: "Unable to load Library Health details. Check logs or try again." }, { status: 500 });
  }
}
