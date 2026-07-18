import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getRepairPreview, previewOverlapRepair } from "@/lib/playlistCoordination";

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const preview = await getRepairPreview(userId, new URL(request.url).searchParams.get("previewId") || "");
  return preview ? NextResponse.json({ preview }) : NextResponse.json({ error: "Preview not found" }, { status: 404 });
}

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ preview: await previewOverlapRepair(userId, await request.json()) }); }
  catch (error: any) { return NextResponse.json({ error: error.message || "Failed to preview repair" }, { status: 400 }); }
}

