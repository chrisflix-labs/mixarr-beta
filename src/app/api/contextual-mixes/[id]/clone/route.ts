import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { cloneContextProfile } from "@/lib/contextualMixProfileService";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ profile: await cloneContextProfile(userId, params.id, body.name) }, { status: 201 });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Context profile could not be cloned" }, { status: 400 }); }
}
