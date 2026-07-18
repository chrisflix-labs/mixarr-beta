import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export function coverageSession() {
  return cookies().get("mixarr_session")?.value || null;
}

export function coverageUnauthorized() {
  return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Sign in with Plex to view library coverage." } }, { status: 401 });
}

export function coverageApiError(error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  if (message === "LIBRARY_NOT_FOUND") return NextResponse.json({ error: { code: message, message: "The selected Plex library was not found." } }, { status: 404 });
  if (message === "JOB_NOT_FOUND") return NextResponse.json({ error: { code: message, message: "Coverage job was not found." } }, { status: 404 });
  console.error("[LibraryCoverage] API request failed", error);
  return NextResponse.json({ error: { code: "COVERAGE_REQUEST_FAILED", message: "Library coverage could not be loaded. Retry or check Job History." } }, { status: 500 });
}

export function numberParam(params: URLSearchParams, key: string, fallback?: number) {
  const value = Number(params.get(key));
  return Number.isFinite(value) ? value : fallback;
}
