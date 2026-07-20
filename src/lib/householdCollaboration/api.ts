import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export function householdApiUserId() {
  return cookies().get("mixarr_session")?.value || null;
}

export function householdApiError(error: any) {
  const validation = error?.name === "ZodError" || Array.isArray(error?.issues);
  const message = error?.issues?.[0]?.message || error?.message || "Household request failed";
  const status = validation ? 400
    : message === "Unauthorized" ? 401
    : message.includes("ADMIN_REQUIRED") || message.includes("eligible") || message.includes("Only the household") ? 403
    : message.includes("not found") ? 404
    : message.includes("already") || message.includes("impossible") ? 409
    : 500;
  if (status >= 500) console.error("[HouseholdCollaboration]", message);
  return NextResponse.json({ error: { code: validation ? "INVALID_HOUSEHOLD_REQUEST" : status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : "HOUSEHOLD_REQUEST_FAILED", message } }, { status });
}

