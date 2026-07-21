import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireAdminUser } from "@/lib/auth";
import { AiError } from "../errors";
import { unexpectedAiError } from "../governance/logging";

export class AiPolicyValidationError extends Error {
  constructor(public fieldErrors: Record<string, string>) { super("One or more AI governance settings are invalid."); this.name = "AiPolicyValidationError"; }
}

export async function requireAiAdmin() { const userId = cookies().get("mixarr_session")?.value; await requireAdminUser(userId); return userId!; }
export const AI_GOVERNANCE_PERMISSIONS = ["VIEW_AI_USAGE", "VIEW_AI_AUDIT", "EXPORT_AI_USAGE", "MANAGE_AI_BUDGETS", "MANAGE_AI_PRICING", "MANAGE_AI_PRIVACY", "ACCEPT_FULL_METADATA_WARNING", "MANAGE_AI_TOKEN_LIMITS", "MANAGE_USER_AI_LIMITS", "MANAGE_BACKGROUND_AI", "MANAGE_AI_RETRY_TIMEOUTS", "VIEW_SANITIZED_AI_DETAILS", "ENABLE_SECURE_AI_DEBUGGING", "OVERRIDE_AI_HARD_SHUTDOWN"] as const;
export type AiGovernancePermission = typeof AI_GOVERNANCE_PERMISSIONS[number];
// Mixarr currently grants governance permissions through its administrator role. Keeping
// named checks at every route makes future role delegation additive without weakening APIs.
export async function requireAiPermission(_permission: AiGovernancePermission) { return requireAiAdmin(); }
export function aiRouteError(error: unknown) {
  if (error instanceof AiError) return NextResponse.json(error.toSafePayload(), { status: error.status });
  if (error instanceof AiPolicyValidationError) { const payload = { code: "AI_POLICY_VALIDATION_FAILED", message: error.message, field_errors: error.fieldErrors }; return NextResponse.json({ error: payload, ...payload }, { status: 400 }); }
  if (error instanceof ZodError) { const payload = { code: "INVALID_REQUEST", message: "Review the highlighted AI governance settings and try again.", details: { issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) } }; return NextResponse.json({ error: payload, ...payload }, { status: 400 }); }
  if ((error as Error)?.message === "UNAUTHORIZED") return NextResponse.json({ error: { code: "PERMISSION_DENIED", message: "Authentication is required." }, code: "PERMISSION_DENIED", message: "Authentication is required." }, { status: 401 });
  if ((error as Error)?.message === "ADMIN_REQUIRED") return NextResponse.json({ error: { code: "PERMISSION_DENIED", message: "Administrator access is required." }, code: "PERMISSION_DENIED", message: "Administrator access is required." }, { status: 403 });
  const normalized = unexpectedAiError(error, { governanceDecisionStage: "api_response_serialization" });
  return NextResponse.json(normalized.toSafePayload(), { status: 500 });
}
