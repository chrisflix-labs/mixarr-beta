import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getPersonalizationProfileSummary, updatePersonalizationSettings } from "@/lib/personalization";

function userId() {
  return cookies().get("mixarr_session")?.value;
}

export async function GET() {
  const currentUserId = userId();
  if (!currentUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await getPersonalizationProfileSummary(currentUserId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Personalization profile is unavailable" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const currentUserId = userId();
  if (!currentUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await updatePersonalizationSettings(currentUserId, await request.json());
    return NextResponse.json(await getPersonalizationProfileSummary(currentUserId));
  } catch (error: any) {
    const message = error?.issues?.[0]?.message || error?.message || "Invalid personalization settings";
    return NextResponse.json({ error: message }, { status: error?.issues ? 400 : 500 });
  }
}

