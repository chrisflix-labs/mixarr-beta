import { NextResponse } from "next/server";
import { communityApiError, communityUserId, unauthorizedCommunity } from "@/lib/communityRecipes/api";
import { stageCommunityInput } from "@/lib/communityRecipes/service";

export async function POST(req: Request) {
  const userId = communityUserId(); if (!userId) return unauthorizedCommunity();
  try { const body = await req.json(); if (typeof body.content !== "string") return NextResponse.json({ error: "Paste JSON or an MXR1 share code.", code: "CONTENT_REQUIRED" }, { status: 400 }); return NextResponse.json(await stageCommunityInput({ userId, content: body.content, filename: "pasted-community-recipe", method: body.content.trim().startsWith("MXR1:") ? "code" : "paste" }), { status: 201 }); }
  catch (error) { return communityApiError(error, "VALIDATION_FAILED"); }
}
