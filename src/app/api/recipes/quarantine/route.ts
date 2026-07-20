import { NextResponse } from "next/server";
import { authorizeSessionOrToken } from "@/lib/integrations/api";
import { listQuarantinedRecipes } from "@/lib/mixRecipes/governanceService";
import { governanceApiError } from "@/lib/mixRecipes/governanceApi";

export async function GET(request: Request) { try { const auth = await authorizeSessionOrToken(request, "recipes.view"); return NextResponse.json({ recipes: await listQuarantinedRecipes(auth.userId) }); } catch (error) { return governanceApiError(error); } }
