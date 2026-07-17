import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { deleteProgressionChain, saveProgressionChain } from "@/lib/playlistCoordination";

export async function PATCH(request: Request, { params }: { params: { chainId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ chain: await saveProgressionChain(userId, await request.json(), params.chainId) }); }
  catch (error: any) { return NextResponse.json({ error: error.message || "Failed to update progression chain" }, { status: 400 }); }
}
export async function DELETE(_request: Request, { params }: { params: { chainId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await deleteProgressionChain(userId, params.chainId)); }
  catch (error: any) { return NextResponse.json({ error: error.message || "Failed to delete progression chain" }, { status: 404 }); }
}
