/**
 * Shared admin authorization for Library Intelligence Backup API routes.
 * Authorization is always enforced on the backend — never only in the UI.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isUserAdmin } from "./auth";

export type BackupAuthResult = { userId: string } | { response: NextResponse };

/**
 * Resolve the current session and require an administrator. Ordinary household
 * users are denied. Returns either the userId or a ready-to-return response.
 */
export async function requireBackupAdmin(): Promise<BackupAuthResult> {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!(await isUserAdmin(userId))) {
    return { response: NextResponse.json({ error: "Administrator access is required to manage library backups." }, { status: 403 }) };
  }
  return { userId };
}

export function isAuthFailure(result: BackupAuthResult): result is { response: NextResponse } {
  return "response" in result;
}
