import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { requireAdminUser } from "@/lib/auth";
import { assessDuplicateRelationship, refreshCanonicalEnrichment, splitTrackFromDuplicateGroup } from "@/lib/duplicateRecordings";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const group = await prisma.canonicalRecording.findFirst({
    where: { id: params.id, library: { server: { userId } } },
    include: {
      library: { select: { id: true, name: true } },
      preferredEnrichmentTrack: { select: { id: true, title: true } },
      tracks: {
        orderBy: [{ preferredDuplicateCopy: "desc" }, { artist: { title: "asc" } }, { title: "asc" }],
        include: { artist: { select: { title: true } }, album: { select: { title: true } }, audioFeature: true, metadataCorrections: { where: { isActive: true } } },
      },
    },
  });
  if (!group) return NextResponse.json({ error: "Duplicate group not found" }, { status: 404 });
  return NextResponse.json({ ...group, tracks: group.tracks.map((track) => ({ ...track, fileSize: track.fileSize?.toString() || null })) });
}

const schema = z.object({
  action: z.enum(["select_preferred", "recalculate_confidence", "split_track", "merge_group", "propagate", "set_inheritance"]),
  trackId: z.string().uuid().optional(),
  targetGroupId: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await requireAdminUser(userId);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid duplicate-group action" }, { status: 400 });
    const group = await prisma.canonicalRecording.findFirst({ where: { id: params.id, library: { server: { userId } } }, include: { tracks: { include: { artist: true, album: true } } } });
    if (!group) return NextResponse.json({ error: "Duplicate group not found" }, { status: 404 });
    if (parsed.data.action === "select_preferred") {
      if (!parsed.data.trackId || !group.tracks.some((track) => track.id === parsed.data.trackId)) return NextResponse.json({ error: "Choose a member of this group" }, { status: 400 });
      await prisma.$transaction([
        prisma.track.updateMany({ where: { canonicalRecordingId: group.id }, data: { preferredDuplicateCopy: false } }),
        prisma.track.update({ where: { id: parsed.data.trackId }, data: { preferredDuplicateCopy: true } }),
        prisma.canonicalRecording.update({ where: { id: group.id }, data: { preferredEnrichmentTrackId: parsed.data.trackId } }),
      ]);
      await refreshCanonicalEnrichment(group.id, parsed.data.trackId);
    } else if (parsed.data.action === "recalculate_confidence") {
      const base = group.tracks[0];
      const assessments = group.tracks.slice(1).map((track) => assessDuplicateRelationship(base, track));
      const confidence = assessments.every((entry) => entry.confidence === "high") ? "high" : assessments.some((entry) => entry.confidence === "low") ? "low" : "medium";
      await prisma.canonicalRecording.update({ where: { id: group.id }, data: { confidence, reviewStatus: confidence === "high" ? "confirmed" : "needs_review", matchEvidence: { recalculated: true, assessments: assessments.map((entry) => entry.evidence) } } });
    } else if (parsed.data.action === "split_track") {
      if (!parsed.data.trackId || !group.tracks.some((track) => track.id === parsed.data.trackId)) return NextResponse.json({ error: "Choose a member of this group" }, { status: 400 });
      await splitTrackFromDuplicateGroup(parsed.data.trackId);
    } else if (parsed.data.action === "merge_group") {
      if (!parsed.data.targetGroupId || parsed.data.targetGroupId === group.id) return NextResponse.json({ error: "Choose a different target group" }, { status: 400 });
      const target = await prisma.canonicalRecording.findFirst({ where: { id: parsed.data.targetGroupId, libraryId: group.libraryId } });
      if (!target) return NextResponse.json({ error: "Target group not found" }, { status: 404 });
      await prisma.$transaction([
        prisma.track.updateMany({ where: { canonicalRecordingId: group.id }, data: { canonicalRecordingId: target.id, duplicateReviewStatus: "confirmed" } }),
        prisma.canonicalRecording.delete({ where: { id: group.id } }),
      ]);
      await refreshCanonicalEnrichment(target.id);
    } else if (parsed.data.action === "propagate") {
      await refreshCanonicalEnrichment(group.id, group.preferredEnrichmentTrackId);
    } else if (parsed.data.action === "set_inheritance") {
      if (typeof parsed.data.enabled !== "boolean") return NextResponse.json({ error: "enabled is required" }, { status: 400 });
      await prisma.canonicalRecording.update({ where: { id: group.id }, data: { inheritanceEnabled: parsed.data.enabled } });
      if (parsed.data.enabled) await refreshCanonicalEnrichment(group.id);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Duplicate-group action failed";
    return NextResponse.json({ error: message }, { status: message === "ADMIN_REQUIRED" ? 403 : 500 });
  }
}
