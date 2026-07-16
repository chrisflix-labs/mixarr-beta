import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { previewAdaptiveReset, resetAdaptiveScoring } from "@/lib/adaptiveScoring";

const schema = z.object({
  confirm: z.literal("RESET ADAPTIVE SCORING"),
  scope: z.enum(["inferred", "settings", "all"]).default("inferred"),
  playlistId: z.string().uuid().nullable().optional(),
});

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  return NextResponse.json(await previewAdaptiveReset(userId, url.searchParams.get("scope") || "inferred", url.searchParams.get("playlistId")));
}

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Type RESET ADAPTIVE SCORING to confirm." }, { status: 400 });
  try {
    return NextResponse.json(await resetAdaptiveScoring(userId, parsed.data.scope, parsed.data.playlistId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Adaptive scoring reset failed" }, { status: 500 });
  }
}
