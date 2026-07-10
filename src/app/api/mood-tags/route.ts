import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";

export async function GET(req: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const serverId = url.searchParams.get("serverId") || undefined;
  const libraryId = url.searchParams.get("libraryId") || undefined;
  const userTrackScope = {
    syncStatus: "active",
    library: {
      ...(libraryId ? { id: libraryId } : {}),
      server: {
        userId,
        ...(serverId ? { id: serverId } : {}),
      },
    },
  };

  const tags = await prisma.tag.findMany({
    where: {
      type: "mood",
      OR: [
        { tracks: { some: userTrackScope } },
        { artists: { some: { tracks: { some: userTrackScope } } } },
        { albums: { some: { tracks: { some: userTrackScope } } } },
      ],
    },
    select: {
      name: true,
    },
  });

  const moods = (await Promise.all(tags.map(async (tag) => ({
      name: tag.name.trim().toLowerCase(),
      count: await prisma.track.count({
        where: {
          ...userTrackScope,
          OR: [
            { tags: { some: { type: "mood", name: tag.name } } },
            { artist: { tags: { some: { type: "mood", name: tag.name } } } },
            { album: { tags: { some: { type: "mood", name: tag.name } } } },
          ],
        },
      }),
    }))))
    .filter((tag) => tag.name && tag.count > 0)
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));

  const [activeTrackCount, missingMoodTrackCount] = await Promise.all([
    prisma.track.count({ where: userTrackScope }),
    prisma.track.count({
      where: {
        ...userTrackScope,
        tags: { none: { type: "mood" } },
        artist: { tags: { none: { type: "mood" } } },
        album: { tags: { none: { type: "mood" } } },
      },
    }),
  ]);

  return NextResponse.json({ moods, activeTrackCount, missingMoodTrackCount });
}
