import { NextResponse } from "next/server";
import { communityApiError, communityUserId, unauthorizedCommunity } from "@/lib/communityRecipes/api";
import { exportCommunityRecipe } from "@/lib/communityRecipes/service";

export async function POST(req: Request, { params }: { params: { id: string } }) { const userId = communityUserId(); if (!userId) return unauthorizedCommunity(); try { const body = await req.json().catch(() => ({})); const result = await exportCommunityRecipe({ userId, recipeId: params.id, type: "code", metadata: body.metadata }); return NextResponse.json({ code: result.content, characterCount: String(result.content).length, checksum: result.checksum, integrityNotice: "The checksum detects accidental corruption; it does not prove authorship or trust." }); } catch (error) { return communityApiError(error, "CODE_EXPORT_FAILED"); } }
