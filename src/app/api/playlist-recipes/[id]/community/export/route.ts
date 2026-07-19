import { NextResponse } from "next/server";
import { communityApiError, communityUserId, unauthorizedCommunity } from "@/lib/communityRecipes/api";
import { exportCommunityRecipe } from "@/lib/communityRecipes/service";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const userId = communityUserId(); if (!userId) return unauthorizedCommunity();
  try { const body = await req.json(); const type = ["json", "bundle", "code"].includes(body.type) ? body.type : "json"; const result = await exportCommunityRecipe({ userId, recipeId: params.id, type, metadata: body.metadata }); return new NextResponse(typeof result.content === "string" ? result.content : Buffer.from(result.content), { headers: { "Content-Type": result.contentType, "Content-Disposition": `attachment; filename="${result.filename}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Mixarr-Checksum": result.checksum } }); }
  catch (error) { return communityApiError(error, "COMMUNITY_EXPORT_FAILED"); }
}
