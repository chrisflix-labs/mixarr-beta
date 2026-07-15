import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireAdminUser } from "@/lib/auth";
import { refreshCanonicalEnrichment, splitTrackFromDuplicateGroup } from "@/lib/duplicateRecordings";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const track = await prisma.track.findFirst({ where: { id: params.id, library: { server: { userId } } }, include: { library: { select: { id: true, name: true } }, artist: true, album: true, audioFeature: true, metadataCorrections: { where: { isActive: true } }, canonicalRecording: { include: { tracks: { include: { artist: true, album: true } }, preferredEnrichmentTrack: { select: { id: true, title: true } } } } } });
  if (!track) return NextResponse.json({ error: "Track not found" }, { status: 404 });
  return NextResponse.json({ ...track, fileSize: track.fileSize?.toString() || null, canonicalRecording: track.canonicalRecording ? { ...track.canonicalRecording, tracks: track.canonicalRecording.tracks.map((copy) => ({ ...copy, fileSize: copy.fileSize?.toString() || null })) } : null });
}

const schema = z.object({ action: z.enum(["analyze_separately", "select_preferred", "remove_from_group", "mark_different", "propagate"]), enabled: z.boolean().optional() });

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await requireAdminUser(userId);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid duplicate action" }, { status: 400 });
    const track = await prisma.track.findFirst({ where: { id: params.id, library: { server: { userId } } }, select: { id: true, canonicalRecordingId: true } });
    if (!track) return NextResponse.json({ error: "Track not found" }, { status: 404 });
    if (parsed.data.action === "analyze_separately") await prisma.track.update({ where: { id: track.id }, data: { inheritDuplicateEnrichment: false, enrichmentProvenance: Prisma.JsonNull, bpmAnalysisStatus: "pending" } });
    else if (parsed.data.action === "remove_from_group" || parsed.data.action === "mark_different") await splitTrackFromDuplicateGroup(track.id);
    else if (parsed.data.action === "select_preferred") {
      if (!track.canonicalRecordingId) return NextResponse.json({ error: "Track is not in a duplicate group" }, { status: 409 });
      await prisma.$transaction([
        prisma.track.updateMany({ where: { canonicalRecordingId: track.canonicalRecordingId }, data: { preferredDuplicateCopy: false } }),
        prisma.track.update({ where: { id: track.id }, data: { preferredDuplicateCopy: true } }),
        prisma.canonicalRecording.update({ where: { id: track.canonicalRecordingId }, data: { preferredEnrichmentTrackId: track.id } }),
      ]);
      await refreshCanonicalEnrichment(track.canonicalRecordingId, track.id);
    } else if (parsed.data.action === "propagate") {
      if (!track.canonicalRecordingId) return NextResponse.json({ error: "Track is not in a duplicate group" }, { status: 409 });
      await refreshCanonicalEnrichment(track.canonicalRecordingId, track.id);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Duplicate action failed";
    return NextResponse.json({ error: message }, { status: message === "ADMIN_REQUIRED" ? 403 : 500 });
  }
}
