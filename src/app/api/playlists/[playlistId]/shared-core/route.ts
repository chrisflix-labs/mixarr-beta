import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { listSharedCoreTracks, setSharedCoreTracks } from "@/lib/playlistCoordination";

const schema = z.object({ trackIds: z.array(z.string().uuid()).min(1).max(500), shared: z.boolean(), relationshipId: z.string().uuid().optional().nullable() });
export async function GET(request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ sharedCoreTracks: await listSharedCoreTracks(userId, params.playlistId, new URL(request.url).searchParams.get("trackId")) }); }
  catch (error: any) { return NextResponse.json({ error: error.message || "Failed to load shared-core tracks" }, { status: 400 }); }
}
export async function POST(request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { const input = schema.parse(await request.json()); return NextResponse.json(await setSharedCoreTracks(userId, params.playlistId, input.trackIds, input.shared, input.relationshipId)); }
  catch (error: any) { return NextResponse.json({ error: error.message || "Failed to update shared-core tracks" }, { status: 400 }); }
}
