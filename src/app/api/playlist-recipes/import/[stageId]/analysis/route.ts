import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { recalculateStagedRecipeAnalysis } from "@/lib/mixRecipes/transferService";

function responseError(error: unknown) {
  const caught = error as Error & { code?: string; status?: number };
  return NextResponse.json({ error: caught.message, code: caught.code || "RECIPE_ANALYSIS_FAILED" }, { status: caught.status || 400 });
}

export async function POST(req: Request, { params }: { params: { stageId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    const recipeIndex = Number(body.recipeIndex);
    if (!Number.isInteger(recipeIndex) || recipeIndex < 0 || recipeIndex > 99) return NextResponse.json({ error: "A valid recipe index is required." }, { status: 400 });
    const edits = Array.isArray(body.edits) ? body.edits.slice(0, 100).map((edit: any) => ({
      id: String(edit.id || "").slice(0, 500),
      action: edit.action,
      mappedValues: Array.isArray(edit.mappedValues) ? edit.mappedValues.map(String).slice(0, 20) : undefined,
      saveForFuture: edit.saveForFuture === true,
    })).filter((edit: any) => edit.id) : [];
    return NextResponse.json(await recalculateStagedRecipeAnalysis({ userId, stageId: params.stageId, recipeIndex, libraryId: typeof body.libraryId === "string" ? body.libraryId : undefined, edits }));
  } catch (error) { return responseError(error); }
}
