import { NextResponse } from "next/server";
import { communityApiError, communityUserId, unauthorizedCommunity } from "@/lib/communityRecipes/api";
import { stageCommunityUrl } from "@/lib/communityRecipes/service";

export async function POST(req: Request) {
  const userId = communityUserId(); if (!userId) return unauthorizedCommunity();
  try { const body = await req.json(); if (typeof body.url !== "string") return NextResponse.json({ error: "An HTTPS recipe URL is required.", code: "URL_REQUIRED" }, { status: 400 }); return NextResponse.json(await stageCommunityUrl(userId, body.url), { status: 201 }); }
  catch (error) { return communityApiError(error, "URL_IMPORT_FAILED"); }
}
