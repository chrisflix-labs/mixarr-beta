import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { cleanupPersonalizationData, previewPersonalizationCleanup } from "@/lib/personalization/dashboard";

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})); const days = Math.max(30, Math.min(3650, Number(body.days) || 90));
  try { if (body.preview !== false) return NextResponse.json(await previewPersonalizationCleanup(userId, days)); if (body.confirm !== true) return NextResponse.json({ error: "Explicit confirmation is required" }, { status: 400 }); return NextResponse.json(await cleanupPersonalizationData(userId, days)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Cleanup failed" }, { status: 500 }); }
}
