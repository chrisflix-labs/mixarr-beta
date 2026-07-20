import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireAdminUser } from "../auth";
import { authorizeApiRequest, IntegrationError } from "./service";
import type { ApiTokenScope } from "./core";
import { sanitizeErrorText } from "../supportRedaction";

export async function requireIntegrationAdmin() {
  const userId = cookies().get("mixarr_session")?.value;
  await requireAdminUser(userId);
  return userId!;
}

export async function authorizeSessionOrToken(request: Request, scope: ApiTokenScope, adminSession = false) {
  const sessionUserId = cookies().get("mixarr_session")?.value;
  if (sessionUserId) {
    if (adminSession) await requireAdminUser(sessionUserId);
    return { userId: sessionUserId, source: "session" as const };
  }
  return { ...(await authorizeApiRequest(request, scope)), source: "token" as const };
}

export function integrationApiError(error: unknown) {
  if (error instanceof IntegrationError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  if ((error as Error)?.message === "UNAUTHORIZED") return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if ((error as Error)?.message === "ADMIN_REQUIRED") return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  console.error("[Integrations] API request failed", sanitizeErrorText(error));
  return NextResponse.json({ error: "The integration request failed.", code: "INTEGRATION_REQUEST_FAILED" }, { status: 500 });
}
