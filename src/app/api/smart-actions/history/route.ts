import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { listSmartActions, smartActionHistoryCsv } from "@/lib/smartActions";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value; if (!userId) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  const query = new URL(request.url).searchParams;
  if (query.get("format") === "csv") return new Response(await smartActionHistoryCsv(userId), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=smart-action-history.csv" } });
  return NextResponse.json(await listSmartActions(userId, { history: true, page: Number(query.get("page") || 1), pageSize: Number(query.get("pageSize") || 25), status: query.get("status") || undefined, actionType: query.get("actionType") || undefined, search: query.get("search") || undefined, sort: query.get("sort") || undefined }), { headers: { "Cache-Control": "no-store" } });
}

