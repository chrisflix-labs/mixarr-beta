import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { resolveContextApplication } from "@/lib/contextualMixProfileService";

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    if (typeof body.profileId !== "string") return NextResponse.json({ error: "Context profile is required" }, { status: 400 });
    return NextResponse.json(await resolveContextApplication({ userId, profileId: body.profileId, influence: body.influence, currentTuning: body.currentTuning, mode: body.mode, manualFields: Array.isArray(body.manualFields) ? body.manualFields : [] }));
  } catch (error: any) { return NextResponse.json({ error: error.message || "Context could not be applied" }, { status: error.message?.includes("loaded") ? 404 : 400 }); }
}
