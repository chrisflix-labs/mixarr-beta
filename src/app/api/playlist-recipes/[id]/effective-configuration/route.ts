import { NextResponse } from "next/server";
import { inheritanceApiError, inheritanceSession, inheritanceUnauthorized } from "@/lib/recipeInheritance/api";
import { resolveOwnedRecipe } from "@/lib/recipeInheritance/service";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const userId = inheritanceSession(); if (!userId) return inheritanceUnauthorized();
  try {
    const url = new URL(request.url);
    const result = await resolveOwnedRecipe(userId, params.id, { playlistId: url.searchParams.get("playlistId"), applyUserPreferences: url.searchParams.get("userPreferences") === "1", groupPolicyIds: url.searchParams.getAll("groupPolicyId") });
    return NextResponse.json(result);
  } catch (error) { return inheritanceApiError(error); }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const userId = inheritanceSession(); if (!userId) return inheritanceUnauthorized();
  try {
    const body = await request.json();
    const result = await resolveOwnedRecipe(userId, params.id, { proposedChanges: body.proposedChanges || body, playlistId: body.playlistId, groupPolicyIds: body.groupPolicyIds, applyUserPreferences: body.applyUserPreferences === true });
    return NextResponse.json(result);
  } catch (error) { return inheritanceApiError(error); }
}
