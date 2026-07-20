import { NextResponse } from "next/server";
import { authorizeSessionOrToken } from "@/lib/integrations/api";
import { approveRecipe, revokeRecipeApproval } from "@/lib/mixRecipes/governanceService";
import { governanceApiError } from "@/lib/mixRecipes/governanceApi";

export async function POST(request: Request, { params }: { params: { id: string } }) { try { const auth = await authorizeSessionOrToken(request, "recipes.approve"); return NextResponse.json({ recipe: await approveRecipe(auth.userId, params.id, await request.json()) }); } catch (error) { return governanceApiError(error, "RECIPE_APPROVAL_FAILED"); } }
export async function DELETE(request: Request, { params }: { params: { id: string } }) { try { const auth = await authorizeSessionOrToken(request, "recipes.manage_trust"); return NextResponse.json({ recipe: await revokeRecipeApproval(auth.userId, params.id) }); } catch (error) { return governanceApiError(error, "RECIPE_APPROVAL_REVOKE_FAILED"); } }
