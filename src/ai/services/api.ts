import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireAdminUser } from "@/lib/auth";
import { AiError } from "../errors";

export async function requireAiAdmin() { const userId = cookies().get("mixarr_session")?.value; await requireAdminUser(userId); return userId!; }
export function aiRouteError(error: unknown) {
  if (error instanceof AiError) return NextResponse.json(error.toSafePayload(), { status: error.status });
  if (error instanceof ZodError) return NextResponse.json({ code: "INVALID_REQUEST", message: "Review the highlighted AI provider settings and try again.", issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) }, { status: 400 });
  if ((error as Error)?.message === "UNAUTHORIZED") return NextResponse.json({ code: "PERMISSION_DENIED", message: "Authentication is required." }, { status: 401 });
  if ((error as Error)?.message === "ADMIN_REQUIRED") return NextResponse.json({ code: "PERMISSION_DENIED", message: "Administrator access is required." }, { status: 403 });
  console.error("[AI] API request failed", { code: "INTERNAL_AI_ERROR" });
  return NextResponse.json({ code: "INTERNAL_AI_ERROR", message: "The AI settings request could not be completed." }, { status: 500 });
}
