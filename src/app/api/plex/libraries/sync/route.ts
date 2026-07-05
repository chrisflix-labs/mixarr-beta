import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { safeRecordJobHistory } from "@/lib/jobHistory";
import { getLibraries } from "@/lib/plex";
import { sanitizeRequiredMetadataString } from "@/lib/metadataSanitizer";

export async function POST(req: Request) {
  const cookieStore = cookies();
  const userId = cookieStore.get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { serverId } = body;

    const server = await prisma.server.findUnique({
      where: { id: serverId, userId },
    });

    if (!server) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }

    const plexLibraries = await getLibraries(server.uri, server.accessToken);

    // Filter for only music libraries (type = "artist")
    const musicLibraries = plexLibraries.filter((lib: any) => lib.type === "artist");

    const syncedLibraries = [];

    for (const lib of musicLibraries) {
      const plexId = sanitizeRequiredMetadataString(lib.key, { entity: "Library", entityId: lib.key, field: "plexId" });
      const name = sanitizeRequiredMetadataString(lib.title, { entity: "Library", entityId: lib.key, field: "name" });
      const type = sanitizeRequiredMetadataString(lib.type, { entity: "Library", entityId: lib.key, field: "type" });
      const dbLib = await prisma.library.upsert({
        where: {
          serverId_plexId: {
            serverId: server.id,
            plexId,
          },
        },
        update: {
          name,
          type,
        },
        create: {
          serverId: server.id,
          plexId,
          name,
          type,
        },
      });
      syncedLibraries.push(dbLib);
    }

    await safeRecordJobHistory({
      userId,
      type: "plex_sync",
      name: "Plex library discovery",
      status: "success",
      trigger: "manual",
      summary: `Plex library discovery completed. attempted=${plexLibraries.length}, processed=${syncedLibraries.length}, skipped=${plexLibraries.length - musicLibraries.length}, failed=0.`,
      counts: { attempted: plexLibraries.length, processed: syncedLibraries.length, skipped: plexLibraries.length - musicLibraries.length, failed: 0 },
      metadata: { serverId },
    });
    return NextResponse.json({ libraries: syncedLibraries });
  } catch (error) {
    console.error("Failed to sync libraries", error);
    await safeRecordJobHistory({
      userId,
      type: "plex_sync",
      name: "Plex library discovery",
      status: "failed",
      trigger: "manual",
      summary: "Plex library discovery failed.",
      error,
    });
    return NextResponse.json({ error: "Failed to sync libraries" }, { status: 500 });
  }
}
