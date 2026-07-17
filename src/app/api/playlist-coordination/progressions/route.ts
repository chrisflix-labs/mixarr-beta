import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { listProgressionChains, saveProgressionChain } from "@/lib/playlistCoordination";

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ chains: await listProgressionChains(userId) });
}
export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ chain: await saveProgressionChain(userId, await request.json()) }, { status: 201 }); }
  catch (error: any) { return NextResponse.json({ error: error.message || "Failed to create progression chain" }, { status: 400 }); }
}
