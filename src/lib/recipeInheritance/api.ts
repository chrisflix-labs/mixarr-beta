import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export function inheritanceSession() { return cookies().get("mixarr_session")?.value || null; }
export function inheritanceUnauthorized() { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
export function inheritanceApiError(error: unknown) {
  const message = error instanceof Error ? error.message : "Recipe inheritance request failed.";
  const status = /not found|missing|unavailable/i.test(message) ? 404 : /admin|required|permission|unauthorized/i.test(message) ? 403 : /invalid|circular|depth|preset|override|lock|conflict/i.test(message) ? 400 : 500;
  if (status === 500) console.error("Recipe inheritance error:", error);
  return NextResponse.json({ error: message }, { status });
}
