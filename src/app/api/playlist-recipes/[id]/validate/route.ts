import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateOwnedRecipe } from "@/lib/mixRecipes/service";
import { safeRecordJobHistory } from "@/lib/jobHistory";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const validated = await validateOwnedRecipe(userId, params.id);
    await safeRecordJobHistory({ userId, type: "mix_recipe", name: "Recipe validated", status: validated.result.valid ? "completed" : "completed_with_warnings", trigger: "manual", summary: `Validated recipe "${validated.recipe.name}" with ${validated.result.errors.length} error(s) and ${validated.result.warnings.length} warning(s).`, counts: { attempted: 1, processed: validated.result.valid ? 1 : 0, failed: validated.result.valid ? 0 : 1 }, metadata: { recipeId: validated.recipe.id, schemaVersion: validated.recipe.schemaVersion, recipeVersion: validated.recipe.recipeVersion } });
    return NextResponse.json(validated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Recipe validation failed.";
    return NextResponse.json({ error: message }, { status: message.includes("not found") ? 404 : 400 });
  }
}

