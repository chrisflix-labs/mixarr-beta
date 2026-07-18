import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ExperimentError } from "./service";

export function experimentUserId() { return cookies().get("mixarr_session")?.value || null; }
export function experimentUnauthorized() { return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 }); }
export function experimentApiError(error: unknown) {
  if (error instanceof ExperimentError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  if (error instanceof ZodError) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: error.issues[0]?.message || "Invalid experiment request", issues: error.issues } }, { status: 400 });
  console.error("[SmartExperiments] API failure", error);
  return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "Smart Experiment request failed" } }, { status: 500 });
}
