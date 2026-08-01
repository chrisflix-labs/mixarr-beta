import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export function communityUserId() { return cookies().get("mixarr_session")?.value || null; }
export function unauthorizedCommunity() { return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 }); }
export function communityApiError(error: unknown, fallback: string) {
  const caught = error as Error & { code?: string; status?: number; field?: string; findings?: Array<{ categoryCode: string; detectorRule: string; path: string }> };
  if (!caught.status || caught.status >= 500) console.warn("[CommunityRecipe] Request failed", { code: caught.code || fallback });
  const findings = caught.findings?.map((finding) => ({ category: finding.categoryCode, detectorRule: finding.detectorRule, path: finding.path }));
  return NextResponse.json({ error: caught.message || "Community recipe request failed.", code: caught.code || fallback, field: caught.field, ...(findings?.length ? { findings } : {}) }, { status: caught.status || 400 });
}
