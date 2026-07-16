import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getContextualMixSettings, updateContextualMixSettings } from "@/lib/contextualMixProfileService";

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ settings: await getContextualMixSettings(userId) });
}
export async function PUT(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ settings: await updateContextualMixSettings(userId, await request.json()) }); }
  catch (error: any) { return NextResponse.json({ error: error.message || "Context settings could not be saved" }, { status: 400 }); }
}
