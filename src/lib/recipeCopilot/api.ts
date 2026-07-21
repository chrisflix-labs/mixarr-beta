import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AiError } from "@/ai/errors";

export function recipeCopilotUserId() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) throw Object.assign(new Error("Authentication is required."), { code: "UNAUTHORIZED", status: 401 });
  return userId;
}

export function recipeCopilotApiError(error: unknown) {
  if (error instanceof AiError) return NextResponse.json(error.toSafePayload(), { status: error.status });
  if (error instanceof ZodError) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: error.issues[0]?.message || "Invalid Recipe Copilot request.", fields: error.flatten() } }, { status: 400 });
  const value = error as any; const status = Number(value?.status) || 500; const code = String(value?.code || value?.category || "AI_RECIPE_REQUEST_FAILED");
  if (status >= 500) console.error("[RecipeCopilot] API failure", { code });
  return NextResponse.json({ error: { code, message: error instanceof Error ? error.message : "Recipe Copilot request failed." } }, { status });
}

