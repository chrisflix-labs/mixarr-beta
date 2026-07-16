import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { deleteCustomContext, getOwnedContextProfile, updateCustomContext } from "@/lib/contextualMixProfileService";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const profile = await getOwnedContextProfile(userId, params.id);
  return profile ? NextResponse.json({ profile }) : NextResponse.json({ error: "Context profile not found" }, { status: 404 });
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (params.id.startsWith("builtin:")) return NextResponse.json({ error: "Built-in contexts are read-only. Clone this context to customize it." }, { status: 409 });
  try { return NextResponse.json({ profile: await updateCustomContext(userId, params.id, await request.json()) }); }
  catch (error: any) { return NextResponse.json({ error: error.issues?.[0]?.message || error.message || "Context profile could not be updated" }, { status: error.message?.includes("not found") ? 404 : 400 }); }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (params.id.startsWith("builtin:")) return NextResponse.json({ error: "Built-in contexts cannot be deleted." }, { status: 409 });
  try { await deleteCustomContext(userId, params.id); return NextResponse.json({ success: true }); }
  catch (error: any) { return NextResponse.json({ error: error.message || "Context profile could not be deleted" }, { status: 404 }); }
}
