import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { requireAdminUser } from "@/lib/auth";
import { assessDuplicateRelationship, assignConfirmedDuplicateGroup, refreshCanonicalEnrichment } from "@/lib/duplicateRecordings";
import { getUserSyncSettings } from "@/lib/syncSettings";
import { alreadyRunningPayload, startSyncJobInBackground } from "@/lib/syncJobRunner";

const MAX_PAGE_SIZE = 100;

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(params.get("pageSize")) || 50));
  const libraryId = params.get("libraryId") || undefined;
  const search = params.get("search")?.trim() || undefined;
  const reason = params.get("reason") || undefined;
  const status = params.get("status") || "unresolved";
  const confidence = params.get("confidence") || undefined;
  const inherited = params.get("inherited");
  const where = {
    library: { ...(libraryId ? { id: libraryId } : {}), server: { userId } },
    ...(status === "all" ? {} : { resolutionStatus: status }),
    ...(reason ? { conflictReason: reason } : {}),
    ...(confidence ? { duplicateConfidence: confidence } : {}),
    ...(inherited === "true" ? { hasInheritedData: true } : inherited === "false" ? { hasInheritedData: false } : {}),
    ...(search ? { OR: [
      { plexRatingKey: { contains: search, mode: "insensitive" as const } },
      { plexGuid: { contains: search, mode: "insensitive" as const } },
      { track: { is: { title: { contains: search, mode: "insensitive" as const } } } },
      { track: { is: { artist: { title: { contains: search, mode: "insensitive" as const } } } } },
      { track: { is: { album: { title: { contains: search, mode: "insensitive" as const } } } } },
    ] } : {}),
  };
  const [total, rows, reasons] = await Promise.all([
    prisma.plexSyncConflict.count({ where }),
    prisma.plexSyncConflict.findMany({
      where,
      orderBy: [{ lastDetectedAt: "desc" }, { plexRatingKey: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        library: { select: { id: true, name: true } },
        track: { include: { artist: { select: { title: true } }, album: { select: { title: true } }, canonicalRecording: { select: { id: true, sharedEnrichment: true } } } },
      },
    }),
    prisma.plexSyncConflict.findMany({ where: { library: { server: { userId } } }, distinct: ["conflictReason"], select: { conflictReason: true }, orderBy: { conflictReason: "asc" } }),
  ]);
  const candidateIds = Array.from(new Set(rows.flatMap((row) => Array.isArray(row.candidateTrackIds) ? row.candidateTrackIds.filter((id): id is string => typeof id === "string") : [])));
  const candidates = candidateIds.length ? await prisma.track.findMany({
    where: { id: { in: candidateIds }, library: { server: { userId } } },
    select: { id: true, title: true, ratingKey: true, fileFormat: true, bitrate: true, mediaPath: true, artist: { select: { title: true } }, album: { select: { title: true } }, canonicalRecordingId: true },
  }) : [];
  const candidateMap = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return NextResponse.json({
    conflicts: rows.map((row) => ({
      ...row,
      track: row.track ? { ...row.track, fileSize: row.track.fileSize?.toString() || null } : null,
      candidates: (Array.isArray(row.candidateTrackIds) ? row.candidateTrackIds : []).map((id) => candidateMap.get(String(id))).filter(Boolean),
      dataAvailableFromDuplicate: Boolean(row.track?.canonicalRecording?.sharedEnrichment),
    })),
    reasons: reasons.map((entry) => entry.conflictReason),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  });
}

const bulkSchema = z.object({
  action: z.enum(["save_all_separate", "auto_group_high_confidence", "apply_available_enrichment", "reanalyze_selected", "mark_selected_reviewed"]),
  libraryId: z.string().uuid().optional(),
  // Backfilled pre-v2.1.1 conflicts intentionally use deterministic `legacy_...`
  // identifiers so repeated migrations and repairs cannot duplicate them.
  conflictIds: z.array(z.string().min(1).max(128)).max(500).optional(),
});

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await requireAdminUser(userId);
    const parsed = bulkSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid bulk action" }, { status: 400 });
    const baseWhere = {
      library: { ...(parsed.data.libraryId ? { id: parsed.data.libraryId } : {}), server: { userId } },
      resolutionStatus: "unresolved",
      ...(parsed.data.conflictIds?.length ? { id: { in: parsed.data.conflictIds } } : {}),
    };
    const rows = await prisma.plexSyncConflict.findMany({
      where: baseWhere,
      take: parsed.data.conflictIds?.length || 1_000,
      include: { track: { include: { artist: true, album: true } } },
    });
    if (parsed.data.action === "save_all_separate" && rows.some((row) => !row.trackId)) {
      if (!parsed.data.libraryId) {
        return NextResponse.json({ error: "Choose a library before repairing unpersisted Plex items." }, { status: 409 });
      }
      const settings = await getUserSyncSettings(userId);
      const libraryId = parsed.data.libraryId;
      const started = startSyncJobInBackground({
        engine: "plex",
        libraryId,
        userId,
        source: "conflict_bulk_save_separate",
        task: () => import("@/lib/syncEngine").then((module) => module.runSyncEngine(libraryId, settings)),
      });
      if (!started.started) return NextResponse.json(alreadyRunningPayload("plex", started.activeJob), { status: 409 });
      return NextResponse.json({
        status: "started",
        processed: 0,
        matched: rows.length,
        message: "Repair started. Missing Plex items will be created as separate active tracks before their duplicate relationships are reviewed.",
      }, { status: 202 });
    }
    let processed = 0;
    if (parsed.data.action === "save_all_separate" || parsed.data.action === "mark_selected_reviewed") {
      for (let offset = 0; offset < rows.length; offset += 100) {
        const batch = rows.slice(offset, offset + 100);
        const trackIds = batch.flatMap((row) => row.trackId ? [row.trackId] : []);
        await prisma.$transaction([
          prisma.track.updateMany({ where: { id: { in: trackIds } }, data: { syncStatus: "active", duplicateReviewStatus: "reviewed", syncConflictReason: null } }),
          prisma.plexSyncConflict.updateMany({ where: { id: { in: batch.map((row) => row.id) } }, data: { resolutionStatus: "resolved_separate", resolvedAt: new Date(), reviewedAt: new Date(), reviewedBy: userId } }),
        ]);
        processed += batch.length;
      }
    } else if (parsed.data.action === "auto_group_high_confidence") {
      for (const row of rows) {
        const candidateId = Array.isArray(row.candidateTrackIds) ? row.candidateTrackIds.find((id) => typeof id === "string") as string | undefined : undefined;
        if (!row.track || !candidateId) continue;
        const candidate = await prisma.track.findFirst({ where: { id: candidateId, libraryId: row.libraryId }, include: { artist: true, album: true } });
        if (!candidate) continue;
        const assessment = assessDuplicateRelationship(row.track, candidate);
        if (!assessment.shouldAutoGroup) continue;
        const grouped = await assignConfirmedDuplicateGroup({ libraryId: row.libraryId, trackId: row.track.id, candidateTrackId: candidate.id, assessment });
        await prisma.plexSyncConflict.update({ where: { id: row.id }, data: { resolutionStatus: "resolved_grouped", resolvedAt: new Date(), reviewedAt: new Date(), reviewedBy: userId, hasInheritedData: grouped.inherited > 0 } });
        processed += 1;
      }
    } else if (parsed.data.action === "apply_available_enrichment") {
      const groupIds = Array.from(new Set(rows.flatMap((row) => row.track?.canonicalRecordingId ? [row.track.canonicalRecordingId] : [])));
      for (const groupId of groupIds) {
        await refreshCanonicalEnrichment(groupId);
        processed += 1;
      }
    } else if (parsed.data.action === "reanalyze_selected") {
      for (let offset = 0; offset < rows.length; offset += 100) {
        const trackIds = rows.slice(offset, offset + 100).flatMap((row) => row.trackId ? [row.trackId] : []);
        const result = await prisma.track.updateMany({ where: { id: { in: trackIds } }, data: { inheritDuplicateEnrichment: false, bpmAnalysisStatus: "pending", duplicateReviewStatus: "reviewed" } });
        processed += result.count;
      }
    }
    return NextResponse.json({ processed, matched: rows.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bulk action failed";
    return NextResponse.json({ error: message }, { status: message === "ADMIN_REQUIRED" ? 403 : 500 });
  }
}
