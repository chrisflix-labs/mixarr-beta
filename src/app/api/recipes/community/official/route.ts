import { NextResponse } from "next/server";
import { communityApiError, communityUserId, unauthorizedCommunity } from "@/lib/communityRecipes/api";
import { loadOfficialRecipeIndex, stageCommunityUrl } from "@/lib/communityRecipes/service";

export async function GET(req: Request) { const userId = communityUserId(); if (!userId) return unauthorizedCommunity(); try { return NextResponse.json(await loadOfficialRecipeIndex(new URL(req.url).searchParams.get("refresh") === "1")); } catch (error) { return communityApiError(error, "OFFICIAL_REPOSITORY_UNAVAILABLE"); } }
export async function POST(req: Request) { const userId = communityUserId(); if (!userId) return unauthorizedCommunity(); try { const body = await req.json(); const index = await loadOfficialRecipeIndex(); const recipe = (index.recipes || []).find((item: any) => item.recipeId === body.recipeId); if (!recipe || !("importUrl" in recipe)) return NextResponse.json({ error: "Official recipe not found.", code: "NOT_FOUND" }, { status: 404 }); return NextResponse.json(await stageCommunityUrl(userId, recipe.importUrl, true), { status: 201 }); } catch (error) { return communityApiError(error, "OFFICIAL_IMPORT_FAILED"); } }
