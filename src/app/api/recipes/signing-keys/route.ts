import { NextResponse } from "next/server";
import { authorizeSessionOrToken } from "@/lib/integrations/api";
import { addSigningKey, listSigningKeys } from "@/lib/mixRecipes/governanceService";
import { governanceApiError } from "@/lib/mixRecipes/governanceApi";

export async function GET(request: Request) { try { await authorizeSessionOrToken(request, "recipes.signing_keys.view"); return NextResponse.json({ keys: await listSigningKeys() }); } catch (error) { return governanceApiError(error); } }
export async function POST(request: Request) { try { const auth = await authorizeSessionOrToken(request, "recipes.signing_keys.manage", true); return NextResponse.json({ key: await addSigningKey(auth.userId, await request.json()) }, { status: 201 }); } catch (error) { return governanceApiError(error, "SIGNING_KEY_CREATE_FAILED"); } }
