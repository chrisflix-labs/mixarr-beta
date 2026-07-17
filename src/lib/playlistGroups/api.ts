import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { playlistGroupErrorResponse } from "./service";

export function playlistGroupSession() { return cookies().get("mixarr_session")?.value || null; }
export function playlistGroupUnauthorized() { return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 }); }
export function playlistGroupApiError(error: unknown) {
  if (error instanceof ZodError) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: error.issues[0]?.message || "Invalid request", issues: error.issues } }, { status: 400 });
  const response = playlistGroupErrorResponse(error);
  return NextResponse.json(response.body, { status: response.status });
}
