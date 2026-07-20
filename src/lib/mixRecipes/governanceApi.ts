import { NextResponse } from "next/server";
import { sanitizeErrorText } from "../supportRedaction";

export function governanceApiError(error: unknown, fallback = "RECIPE_GOVERNANCE_FAILED") {
  const caught = error as Error & { code?: string; status?: number; consequences?: unknown; conflicts?: unknown };
  if (!caught.status || caught.status >= 500) console.error("[RecipeGovernance] Request failed", sanitizeErrorText(error));
  return NextResponse.json({ error: caught.message || "Recipe governance request failed.", code: caught.code || fallback, ...(caught.consequences ? { consequences: caught.consequences } : {}), ...(caught.conflicts ? { conflicts: caught.conflicts } : {}) }, { status: caught.status || (caught.message === "ADMIN_REQUIRED" ? 403 : 400) });
}
