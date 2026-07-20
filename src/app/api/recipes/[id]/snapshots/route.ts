import { NextResponse } from "next/server";
import { authorizeSessionOrToken } from "@/lib/integrations/api";
import { listRecipeSnapshots } from "@/lib/mixRecipes/governanceService";
import { governanceApiError } from "@/lib/mixRecipes/governanceApi";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await authorizeSessionOrToken(request, "recipes.restore");
    return NextResponse.json({ snapshots: await listRecipeSnapshots(auth.userId, params.id) });
  } catch (error) {
    return governanceApiError(error, "RECIPE_SNAPSHOT_LIST_FAILED");
  }
}
