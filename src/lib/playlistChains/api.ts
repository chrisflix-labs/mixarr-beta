import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function chainSession() { return cookies().get("mixarr_session")?.value || null; }
export function chainUnauthorized() { return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Authentication is required." } }, { status: 401 }); }
export function chainApiError(error: unknown) {
  if (error instanceof ZodError) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: error.issues[0]?.message || "The request is invalid.", details: error.flatten() } }, { status: 400 });
  const message = error instanceof Error ? error.message : "The playlist-chain request failed.";
  const notFound = /not found/i.test(message);
  const conflict = /changed after|before deleting|already|duplicate/i.test(message);
  return NextResponse.json({ error: { code: notFound ? "NOT_FOUND" : conflict ? "CONFLICT" : "CHAIN_REQUEST_FAILED", message } }, { status: notFound ? 404 : conflict ? 409 : 400 });
}
export function pagination(request: Request) {
  const url = new URL(request.url); const page = Math.max(1, Number(url.searchParams.get("page")) || 1); const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize")) || 20));
  return { url, page, pageSize };
}

