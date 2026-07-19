import { NextResponse } from "next/server";
import { communityApiError, communityUserId, unauthorizedCommunity } from "@/lib/communityRecipes/api";
import { stageCommunityInput } from "@/lib/communityRecipes/service";
import { MAX_COMMUNITY_ARCHIVE_BYTES } from "@/lib/communityRecipes/core";

export async function POST(req: Request) {
  const userId = communityUserId(); if (!userId) return unauthorizedCommunity();
  try { const form = await req.formData(); const file = form.get("file"); if (!(file instanceof File)) return NextResponse.json({ error: "Choose a community recipe JSON or ZIP bundle.", code: "FILE_REQUIRED" }, { status: 400 }); if (file.size > MAX_COMMUNITY_ARCHIVE_BYTES) return NextResponse.json({ error: "The upload exceeds the 20 MB limit.", code: "FILE_TOO_LARGE" }, { status: 413 }); const bytes = new Uint8Array(await file.arrayBuffer()); const zip = bytes[0] === 0x50 && bytes[1] === 0x4b; return NextResponse.json(await stageCommunityInput({ userId, content: zip ? bytes : Buffer.from(bytes).toString("utf8"), filename: file.name, method: "upload" }), { status: 201 }); }
  catch (error) { return communityApiError(error, "UPLOAD_IMPORT_FAILED"); }
}
