import { NextResponse } from "next/server";
import { communityApiError, communityUserId, unauthorizedCommunity } from "@/lib/communityRecipes/api";
import { installStagedCommunityRecipe } from "@/lib/communityRecipes/service";

export async function POST(req: Request) {
  const userId = communityUserId(); if (!userId) return unauthorizedCommunity();
  try { const body = await req.json(); if (typeof body.stageId !== "string") return NextResponse.json({ error: "Validate and preview this recipe first.", code: "STAGE_REQUIRED" }, { status: 400 }); return NextResponse.json(await installStagedCommunityRecipe({ userId, stageId: body.stageId, name: body.name, action: body.action, confirmReplace: body.confirmReplace }), { status: 201 }); }
  catch (error) { return communityApiError(error, "INSTALL_FAILED"); }
}
