import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { orchestrationErrorResponse } from "./service";
import { isUserAdmin } from "../auth";

export function orchestrationSession() { return cookies().get("mixarr_session")?.value || null; }
export function orchestrationUnauthorized() { return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Authentication is required." } }, { status: 401 }); }
export function orchestrationForbidden() { return NextResponse.json({ error: { code: "ADMIN_REQUIRED", message: "Administrator permission is required for this orchestration operation." } }, { status: 403 }); }
export async function orchestrationAdmin(userId: string) { return isUserAdmin(userId); }
export function orchestrationApiError(error: unknown) { const result = orchestrationErrorResponse(error); return NextResponse.json(result.body, { status: result.status }); }
export function pageInput(request: Request) {
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 25));
  return { url, page, pageSize, skip: (page - 1) * pageSize };
}
