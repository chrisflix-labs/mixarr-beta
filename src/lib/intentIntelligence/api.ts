import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function intentUserId() { const userId = cookies().get("mixarr_session")?.value; if (!userId) throw Object.assign(new Error("Unauthorized"), { code: "UNAUTHORIZED", status: 401 }); return userId; }
export function intentApiError(caught: unknown) {
  if (caught instanceof ZodError) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: caught.issues[0]?.message || "Invalid request.", fields: caught.flatten() } }, { status: 400 });
  const value = caught as any, status = Number(value?.status) || 500, code = String(value?.code || "INTENT_REQUEST_FAILED");
  if (status >= 500) console.error("[IntentIntelligence] API failure", { code });
  return NextResponse.json({ error: { code, message: caught instanceof Error ? caught.message : "The intent request could not be completed." } }, { status });
}
