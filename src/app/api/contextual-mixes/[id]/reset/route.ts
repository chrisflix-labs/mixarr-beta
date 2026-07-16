import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { resetClonedContext } from "@/lib/contextualMixProfileService";

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ profile: await resetClonedContext(userId, params.id) }); }
  catch (error: any) { return NextResponse.json({ error: error.message || "Context could not be reset" }, { status: 400 }); }
}
