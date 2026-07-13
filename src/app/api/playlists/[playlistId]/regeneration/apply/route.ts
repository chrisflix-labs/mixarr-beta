import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { applyAdvancedPlaylistRegeneration } from "@/lib/playlistService";

const schema = z.object({
  previewId: z.string().min(1),
  acceptedPositions: z.array(z.coerce.number().int().min(1)).max(100).optional(),
  lockProposedPositions: z.array(z.coerce.number().int().min(1)).max(100).default([]),
});

export async function POST(request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const input = schema.parse(await request.json());
    return NextResponse.json(await applyAdvancedPlaylistRegeneration({ userId, generatedPlaylistId: params.playlistId, ...input }));
  } catch (error: any) {
    const message = error?.issues?.[0]?.message || error.message || "Failed to apply regeneration";
    const status = error?.issues ? 400 : message.includes("changed") || message.includes("no longer") ? 409 : message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

