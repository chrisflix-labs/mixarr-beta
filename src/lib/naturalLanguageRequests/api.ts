import { ZodError } from "zod";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export function naturalLanguageUserId() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) throw Object.assign(new Error("Unauthorized"), { code: "UNAUTHORIZED", status: 401 });
  return userId;
}

export function naturalLanguageApiError(error: unknown) {
  if (error instanceof ZodError) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: error.issues[0]?.message || "Invalid request.", fields: error.flatten() } }, { status: 400 });
  const value = error as any;
  const status = Number(value?.status) || (value?.category ? 409 : 500);
  const code = String(value?.code || value?.category || "NATURAL_LANGUAGE_REQUEST_FAILED");
  if (status >= 500) console.error("[NaturalLanguageRequest] API failure", { code });
  return NextResponse.json({ error: { code, message: error instanceof Error ? error.message : "The request could not be completed." } }, { status });
}
