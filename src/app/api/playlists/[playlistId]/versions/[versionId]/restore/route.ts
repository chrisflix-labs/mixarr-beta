import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { previewPlaylistVersionRestore, restorePlaylistVersion } from "@/lib/playlists/versions/playlist-version-restore";

const schema = z.object({
  confirm: z.boolean().default(false),
  expectedPlaylistUpdatedAt: z.string().datetime().optional(),
  missingTrackStrategy: z.enum(["cancel", "restore_available"]).default("cancel"),
  restoreSettings: z.boolean().default(true),
  restorePlaylistMetadata: z.boolean().default(false),
  restoreIdentitySnapshot: z.boolean().default(false),
});

export async function POST(request: Request, { params }: { params: { playlistId: string; versionId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid restore request" }, { status: 400 });
  try {
    if (!parsed.data.confirm) return NextResponse.json(await previewPlaylistVersionRestore(userId, params.playlistId, params.versionId));
    if (!parsed.data.expectedPlaylistUpdatedAt) return NextResponse.json({ error: "Create a restore preview before applying the restore." }, { status: 409 });
    return NextResponse.json(await restorePlaylistVersion({ userId, generatedPlaylistId: params.playlistId, versionId: params.versionId, expectedPlaylistUpdatedAt: parsed.data.expectedPlaylistUpdatedAt, missingTrackStrategy: parsed.data.missingTrackStrategy, restoreSettings: parsed.data.restoreSettings, restorePlaylistMetadata: parsed.data.restorePlaylistMetadata, restoreIdentitySnapshot: parsed.data.restoreIdentitySnapshot }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Restore failed. The playlist was not changed.";
    return NextResponse.json({ error: message }, { status: /changed|preview/i.test(message) ? 409 : 400 });
  }
}
