import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/auth";
import { getStorageDiagnostics, runStorageCleanup } from "@/lib/storageMaintenance";

export const dynamic = "force-dynamic";

function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : "Storage operation failed.";
  const status = message === "UNAUTHORIZED" ? 401 : message === "ADMIN_REQUIRED" ? 403 : 500;
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  try {
    await requireAdminUser(cookies().get("mixarr_session")?.value);
    return NextResponse.json(await getStorageDiagnostics(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

const requestSchema = z.object({
  action: z.enum(["cleanup_expired", "clear_cache", "clear_all_cache", "clear_temp", "prune_jobs", "prune_scans", "prune_ai", "remove_orphaned_artwork", "database_checkpoint", "report"]),
  dryRun: z.boolean().default(true),
  confirm: z.literal("DELETE MIXARR MANAGED DATA").optional(),
});

export async function POST(request: Request) {
  try {
    const actorId = await requireAdminUser(cookies().get("mixarr_session")?.value);
    const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid storage operation." }, { status: 400 });
    if (parsed.data.action === "report") return NextResponse.json(await getStorageDiagnostics());
    if (parsed.data.action === "database_checkpoint") {
      return NextResponse.json({ applied: false, databaseEngine: "postgresql", message: "SQLite checkpointing is not applicable. PostgreSQL WAL and vacuuming are managed by PostgreSQL." });
    }
    if (!parsed.data.dryRun && parsed.data.confirm !== "DELETE MIXARR MANAGED DATA") {
      return NextResponse.json({ error: "Confirmation text is required before deleting Mixarr-managed data. Music library files are never included." }, { status: 409 });
    }
    const scopes = { cleanup_expired: "expired", clear_cache: "cache", clear_all_cache: "all_cache", clear_temp: "temp", prune_jobs: "jobs", prune_scans: "scans", prune_ai: "ai", remove_orphaned_artwork: "artwork" } as const;
    const result = await runStorageCleanup({ scope: scopes[parsed.data.action], dryRun: parsed.data.dryRun, actorId });
    return NextResponse.json({
      result,
      deletes: "Only Mixarr-managed cache, temporary files, and expired history selected by the requested scope.",
      preserves: "Music files, Plex libraries, active jobs, active cache files, accounts, settings, and non-expired records.",
    });
  } catch (error) { return apiError(error); }
}
