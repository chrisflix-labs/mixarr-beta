import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function troubleshootingUserId() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) throw Object.assign(new Error("Authentication is required."), { code: "UNAUTHORIZED", status: 401 });
  return userId;
}

export function troubleshootingApiError(error: unknown) {
  if (error instanceof ZodError) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Review the request and try again.", details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) } }, { status: 400 });
  const value = error as any, status = Number(value?.status) || 500, code = String(value?.code || value?.category || "TROUBLESHOOTING_ERROR");
  const message = status >= 500 ? "The troubleshooting operation could not be completed safely." : error instanceof Error ? error.message : "The troubleshooting request could not be completed.";
  return NextResponse.json({ error: { code, message }, code, message }, { status });
}
