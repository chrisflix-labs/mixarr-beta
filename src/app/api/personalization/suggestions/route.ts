import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { listPersonalizationSuggestions } from "@/lib/personalization/dashboard";

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url); const period = url.searchParams.get("period");
  try {
    return NextResponse.json(await listPersonalizationSuggestions(userId, { page: Number(url.searchParams.get("page")), pageSize: Number(url.searchParams.get("pageSize")), status: url.searchParams.get("status") || undefined, playlistId: url.searchParams.get("playlistId") || undefined, query: url.searchParams.get("query") || undefined, days: period === "all" ? null : Number(period) || 30 }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Suggestion history is unavailable" }, { status: 500 });
  }
}
