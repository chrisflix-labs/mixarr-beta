import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getTrackMetadataCorrectionHistory, metadataCorrectionErrorResponse } from "@/lib/metadataCorrectionService";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  try { return NextResponse.json({ history: await getTrackMetadataCorrectionHistory(userId, params.id) }); }
  catch (error) { const response = metadataCorrectionErrorResponse(error); return NextResponse.json(response.body, { status: response.status }); }
}
