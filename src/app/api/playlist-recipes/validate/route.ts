import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validatePlaylistRecipeDraft } from "@/lib/playlistRecipes";
import {
  playlistRecipeCorrelationId,
  playlistRecipeValidationResponse,
} from "@/lib/playlistRecipeApiValidation";

export async function POST(req: Request) {
  const correlationId = playlistRecipeCorrelationId(req);
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const result = validatePlaylistRecipeDraft(body?.recipe ?? body);
  if (!result.success) return playlistRecipeValidationResponse(result.issues, correlationId);
  return NextResponse.json({
    valid: true,
    draftSchemaValid: true,
    saveSemanticValidationValid: true,
    executionCompatibilityValid: true,
    normalizedDraft: result.data,
    errors: [],
  });
}

