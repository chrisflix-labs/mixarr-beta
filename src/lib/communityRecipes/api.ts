import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export function communityUserId() { return cookies().get("mixarr_session")?.value || null; }
export function unauthorizedCommunity() { return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 }); }
export function communityApiError(error: unknown, fallback: string) {
  const caught = error as Error & { code?: string; status?: number; field?: string };
  if (!caught.status || caught.status >= 500) console.warn("[CommunityRecipe] Request failed", { code: caught.code || fallback });
  return NextResponse.json({ error: caught.message || "Community recipe request failed.", code: caught.code || fallback, field: caught.field }, { status: caught.status || 400 });
}
