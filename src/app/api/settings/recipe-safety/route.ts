import { NextResponse } from "next/server";
import { authorizeSessionOrToken } from "@/lib/integrations/api";
import { getRecipeSafetyPolicy, updateRecipeSafetyPolicy } from "@/lib/mixRecipes/governanceService";
import { governanceApiError } from "@/lib/mixRecipes/governanceApi";

export async function GET(request: Request) { try { const auth = await authorizeSessionOrToken(request, "recipes.view"); return NextResponse.json(await getRecipeSafetyPolicy(auth.userId)); } catch (error) { return governanceApiError(error); } }
export async function PATCH(request: Request) { try { const auth = await authorizeSessionOrToken(request, "recipes.manage_trust", true); const body = await request.json(); return NextResponse.json({ policy: await updateRecipeSafetyPolicy(auth.userId, body.limits || body) }); } catch (error) { return governanceApiError(error, "RECIPE_SAFETY_POLICY_UPDATE_FAILED"); } }
