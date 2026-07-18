import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { generateSmartActions } from "@/lib/smartActions";
const schema = z.object({ libraryId: z.string().optional(), playlistId: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }).strict();
export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message, code: "INVALID_INPUT" }, { status: 400 });
  try { return NextResponse.json(await generateSmartActions(userId, parsed.data), { status: 202 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Generation failed", code: "GENERATION_FAILED" }, { status: 500 }); }
}

