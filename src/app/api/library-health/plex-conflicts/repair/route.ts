import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { requireAdminUser } from "@/lib/auth";
import { previewPlexConflictRepair } from "@/lib/plexConflictRepair";
import { getUserSyncSettings } from "@/lib/syncSettings";
import { alreadyRunningPayload, startSyncJobInBackground } from "@/lib/syncJobRunner";

const bodySchema = z.object({ libraryId: z.string().uuid() });

async function authorizedLibrary(userId: string, libraryId: string) {
  await requireAdminUser(userId);
  return prisma.library.findFirst({ where: { id: libraryId, server: { userId } }, select: { id: true } });
}

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const libraryId = new URL(request.url).searchParams.get("libraryId") || "";
  try {
    if (!(await authorizedLibrary(userId, libraryId))) return NextResponse.json({ error: "Library not found" }, { status: 404 });
    return NextResponse.json(await previewPlexConflictRepair(userId, libraryId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Repair preview failed";
    return NextResponse.json({ error: message }, { status: message === "ADMIN_REQUIRED" ? 403 : 502 });
  }
}

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A valid library ID is required" }, { status: 400 });
  try {
    if (!(await authorizedLibrary(userId, parsed.data.libraryId))) return NextResponse.json({ error: "Library not found" }, { status: 404 });
    const settings = await getUserSyncSettings(userId);
    const started = startSyncJobInBackground({
      engine: "plex",
      libraryId: parsed.data.libraryId,
      userId,
      source: "conflict_repair",
      task: () => import("@/lib/syncEngine").then((module) => module.runSyncEngine(parsed.data.libraryId, settings)),
    });
    if (!started.started) return NextResponse.json(alreadyRunningPayload("plex", started.activeJob), { status: 409 });
    return NextResponse.json({ status: "started", message: "Repair is running. Every current Plex item will be persisted before duplicate relationships are reviewed." }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Repair could not start";
    return NextResponse.json({ error: message }, { status: message === "ADMIN_REQUIRED" ? 403 : 500 });
  }
}
