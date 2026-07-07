import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { safeRecordJobHistory } from "@/lib/jobHistory";
import { genreHealthFilterWhere, isGenreHealthFilter, missingGenresWhere } from "@/lib/libraryHealth";
import { buildRetryExplanation } from "@/lib/retryExplanations";

const requestSchema = z.object({
  trackIds: z.array(z.string().uuid()).max(10_000).optional(),
  filter: z.string().optional(),
  libraryId: z.string().uuid().optional(),
  force: z.boolean().default(false),
}).refine((body) => (body.trackIds?.length || 0) > 0 || !!body.filter, {
  message: "Provide trackIds or a filter",
});

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid retry request" }, { status: 400 });
    }
    const { trackIds, filter, libraryId, force } = parsed.data;
    if (!trackIds?.length && !isGenreHealthFilter(filter)) {
      return NextResponse.json({ error: "A valid genre health filter is required" }, { status: 400 });
    }

    const targetWhere = trackIds?.length
      ? { id: { in: trackIds } }
      : isGenreHealthFilter(filter) ? genreHealthFilterWhere(filter) : { id: "__invalid__" };
    const baseWhere = {
      AND: [
        {
          syncStatus: "active",
          library: { ...(libraryId ? { id: libraryId } : {}), server: { userId } },
        },
        targetWhere,
      ],
    };
    const where = {
      AND: [
        baseWhere,
        ...(force ? [] : [missingGenresWhere()]),
      ],
    };
    const [matched, matching] = await Promise.all([
      prisma.track.count({ where: baseWhere }),
      prisma.track.findMany({
        where,
        select: { id: true, title: true, artist: { select: { title: true } }, tags: { where: { type: "genre" }, select: { id: true } } },
      }),
    ]);
    const ids = matching.map((track) => track.id);
    const skipped = Math.max(0, matched - ids.length);
    const skipReasons: Record<string, number> = skipped ? { already_has_genres: skipped } : {};
    const retryExplanation = buildRetryExplanation({
      retryType: "genre",
      filter: filter || "selected_tracks",
      matched,
      queued: ids.length,
      skipped,
      skipReasons,
      mode: force ? "force" : "configured",
    });

    for (let offset = 0; offset < ids.length; offset += 5_000) {
      const chunk = ids.slice(offset, offset + 5_000);
      await prisma.track.updateMany({
        where: { id: { in: chunk } },
        data: {
          tagsSyncedAt: null,
          genreStatus: "pending",
          genreFailureReason: null,
          genreAttemptedAt: null,
        },
      });
    }

    if (force) {
      for (const track of matching) {
        if (!track.tags.length) continue;
        await prisma.track.update({
          where: { id: track.id },
          data: { tags: { disconnect: track.tags.map((tag) => ({ id: tag.id })) } },
          select: { id: true },
        });
      }
    }

    if (trackIds?.length && matching.length === 1) {
      console.log(`[LibraryHealth] Queued genre retry for track: ${matching[0].artist.title} - ${matching[0].title}`);
    } else {
      console.log(`[LibraryHealth] genre retry filter=${filter || "selected_tracks"} matched=${matched} queued=${ids.length} skipped=${skipped}`);
    }
    await safeRecordJobHistory({
      userId,
      type: "library_health",
      name: "Genre retry",
      status: "success",
      trigger: "retry",
      summary: retryExplanation.message,
      counts: { attempted: matched, processed: ids.length, skipped, failed: 0 },
      metadata: { filter: filter || "selected_tracks", matched, queued: ids.length, skipped, skipReasons, libraryId: libraryId || null, force },
    });
    return NextResponse.json({ queued: ids.length, matched, skipped, skipReasons, trackIds: ids, summary: retryExplanation.summary, message: retryExplanation.message });
  } catch (error) {
    console.error("[LibraryHealth] Failed to queue genre retry", error);
    await safeRecordJobHistory({
      userId,
      type: "library_health",
      name: "Genre retry",
      status: "failed",
      trigger: "retry",
      summary: "Genre retry queue failed.",
      error,
    });
    return NextResponse.json({ error: "Failed to queue genre retry" }, { status: 500 });
  }
}
