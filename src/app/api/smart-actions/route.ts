import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { listSmartActions } from "@/lib/smartActions";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  const query = new URL(request.url).searchParams;
  try {
    return NextResponse.json(await listSmartActions(userId, {
      page: Number(query.get("page") || 1), pageSize: Number(query.get("pageSize") || 25), status: query.get("status") || undefined,
      actionType: query.get("actionType") || undefined, confidence: query.get("confidence") || undefined, risk: query.get("risk") || undefined,
      playlistId: query.get("playlistId") || undefined, libraryId: query.get("libraryId") || undefined, search: query.get("search") || undefined,
      sort: query.get("sort") || undefined,
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load Smart Actions" }, { status: 400 }); }
}

