import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { orchestrationApiError, orchestrationSession, orchestrationUnauthorized, pageInput } from "@/lib/orchestration/api";
import { registerManagedPlaylist } from "@/lib/orchestration/service";

const schema = z.object({ libraryId: z.string().uuid(), playlistId: z.string().min(1).max(200).optional(), generatedPlaylistId: z.string().uuid().optional(), displayName: z.string().min(1).max(200).optional(), automationEnabled: z.boolean().optional(), priority: z.enum(["HIGH", "NORMAL", "LOW"]).optional() }).refine((value) => value.playlistId || value.generatedPlaylistId, "playlistId or generatedPlaylistId is required");
export async function GET(request: Request) {
  const userId = orchestrationSession(); if (!userId) return orchestrationUnauthorized();
  const { page, pageSize, skip, url } = pageInput(request);
  const state = url.searchParams.get("state"); const priority = url.searchParams.get("priority");
  const where: any = { userId, enabled: url.searchParams.get("includeUnregistered") === "true" ? undefined : true };
  if (state) where.automationState = state; if (priority) where.priority = priority;
  try { const [items, total, available, libraries] = await Promise.all([
    prisma.managedPlaylist.findMany({ where, include: { generatedPlaylist: { select: { id: true, plexPlaylistTitle: true, trackCount: true } }, relationshipSources: { where: { enabled: true }, select: { id: true } }, relationshipTargets: { where: { enabled: true }, select: { id: true } }, jobs: { where: { status: { in: ["QUEUED", "WAITING", "BLOCKED", "RUNNING"] } }, orderBy: { requestedAt: "asc" }, take: 1 } }, orderBy: [{ priority: "asc" }, { displayName: "asc" }], skip, take: pageSize }),
    prisma.managedPlaylist.count({ where }),
    prisma.generatedPlaylist.findMany({ where: { userId, managedPlaylist: null, plexPlaylistRatingKey: { not: null } }, select: { id: true, plexPlaylistRatingKey: true, plexPlaylistTitle: true, trackCount: true }, orderBy: { updatedAt: "desc" }, take: 100 }),
    prisma.library.findMany({ where: { server: { userId }, type: "artist" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]); return NextResponse.json({ items, available, libraries, pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) } }); } catch (error) { return orchestrationApiError(error); }
}
export async function POST(request: Request) {
  const userId = orchestrationSession(); if (!userId) return orchestrationUnauthorized();
  try { const input = schema.parse(await request.json()); const playlist = await registerManagedPlaylist({ userId, ...input, actorId: userId }); return NextResponse.json({ playlist }, { status: 201 }); } catch (error) { return orchestrationApiError(error); }
}
