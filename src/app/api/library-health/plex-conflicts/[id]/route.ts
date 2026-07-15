import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireAdminUser } from "@/lib/auth";
import { assessDuplicateRelationship, assignConfirmedDuplicateGroup, refreshCanonicalEnrichment, splitTrackFromDuplicateGroup } from "@/lib/duplicateRecordings";

const schema = z.object({
  action: z.enum(["save_separate", "add_to_group", "create_group", "mark_not_duplicate", "apply_enrichment", "analyze_separately", "mark_reviewed"]),
  groupId: z.string().min(1).optional(),
  candidateTrackId: z.string().uuid().optional(),
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await requireAdminUser(userId);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid action" }, { status: 400 });
    const conflict = await prisma.plexSyncConflict.findFirst({
      where: { id: params.id, library: { server: { userId } } },
      include: { track: { include: { artist: true, album: true } } },
    });
    if (!conflict?.track) return NextResponse.json({ error: "Conflict or preserved track not found" }, { status: 404 });
    const { action } = parsed.data;

    if (action === "save_separate" || action === "mark_reviewed") {
      await prisma.$transaction([
        prisma.track.update({ where: { id: conflict.track.id }, data: { syncStatus: "active", duplicateReviewStatus: "reviewed", syncConflictReason: null } }),
        prisma.plexSyncConflict.update({ where: { id: conflict.id }, data: { resolutionStatus: "resolved_separate", resolvedAt: new Date(), reviewedAt: new Date(), reviewedBy: userId } }),
      ]);
    } else if (action === "mark_not_duplicate") {
      await splitTrackFromDuplicateGroup(conflict.track.id);
      await prisma.plexSyncConflict.update({ where: { id: conflict.id }, data: { resolutionStatus: "resolved_not_duplicate", resolvedAt: new Date(), reviewedAt: new Date(), reviewedBy: userId } });
    } else if (action === "add_to_group") {
      if (!parsed.data.groupId) return NextResponse.json({ error: "groupId is required" }, { status: 400 });
      const group = await prisma.canonicalRecording.findFirst({ where: { id: parsed.data.groupId, library: { server: { userId } } } });
      if (!group) return NextResponse.json({ error: "Duplicate group not found" }, { status: 404 });
      await prisma.track.update({ where: { id: conflict.track.id }, data: { canonicalRecordingId: group.id, duplicateConfidence: "confirmed_manual", duplicateReviewStatus: "confirmed", duplicateMatchEvidence: { signals: ["administrator_assignment"] } } });
      const inherited = await refreshCanonicalEnrichment(group.id);
      await prisma.plexSyncConflict.update({ where: { id: conflict.id }, data: { resolutionStatus: "resolved_grouped", resolvedAt: new Date(), reviewedAt: new Date(), reviewedBy: userId, hasInheritedData: inherited.inherited > 0 } });
    } else if (action === "create_group") {
      if (!parsed.data.candidateTrackId) return NextResponse.json({ error: "candidateTrackId is required" }, { status: 400 });
      const candidate = await prisma.track.findFirst({ where: { id: parsed.data.candidateTrackId, libraryId: conflict.libraryId }, include: { artist: true, album: true } });
      if (!candidate) return NextResponse.json({ error: "Candidate track not found" }, { status: 404 });
      const assessment = assessDuplicateRelationship(conflict.track, candidate);
      const grouped = await assignConfirmedDuplicateGroup({ libraryId: conflict.libraryId, trackId: conflict.track.id, candidateTrackId: candidate.id, assessment: { ...assessment, confidence: "high", shouldAutoGroup: true, needsReview: false } });
      await prisma.plexSyncConflict.update({ where: { id: conflict.id }, data: { resolutionStatus: "resolved_grouped", resolvedAt: new Date(), reviewedAt: new Date(), reviewedBy: userId, hasInheritedData: grouped.inherited > 0 } });
    } else if (action === "apply_enrichment") {
      if (!conflict.track.canonicalRecordingId) return NextResponse.json({ error: "Track is not in a confirmed duplicate group" }, { status: 409 });
      const inherited = await refreshCanonicalEnrichment(conflict.track.canonicalRecordingId);
      await prisma.plexSyncConflict.update({ where: { id: conflict.id }, data: { hasInheritedData: inherited.inherited > 0, reviewedAt: new Date(), reviewedBy: userId } });
    } else if (action === "analyze_separately") {
      await prisma.track.update({ where: { id: conflict.track.id }, data: { inheritDuplicateEnrichment: false, enrichmentProvenance: Prisma.JsonNull, duplicateReviewStatus: "reviewed" } });
      await prisma.plexSyncConflict.update({ where: { id: conflict.id }, data: { resolutionStatus: "resolved_separate_analysis", resolvedAt: new Date(), reviewedAt: new Date(), reviewedBy: userId } });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Conflict action failed";
    return NextResponse.json({ error: message }, { status: message === "ADMIN_REQUIRED" ? 403 : 500 });
  }
}
