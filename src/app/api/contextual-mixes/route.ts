import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createCustomContext, listContextProfiles } from "@/lib/contextualMixProfileService";

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await listContextProfiles(userId)); }
  catch (error: any) { return NextResponse.json({ error: error.message || "Context profiles could not be loaded" }, { status: 500 }); }
}

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ profile: await createCustomContext(userId, await request.json()) }, { status: 201 }); }
  catch (error: any) { return NextResponse.json({ error: error.issues?.[0]?.message || error.message || "Context profile could not be created" }, { status: 400 }); }
}
