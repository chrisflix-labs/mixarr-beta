import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getTrackExplanation } from "@/lib/smartMixExplanations/service";

export async function GET(req: Request, { params }: { params: { trackId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const result = await getTrackExplanation(userId, { trackId: params.trackId, generationId: url.searchParams.get("generationId"), generatedPlaylistId: url.searchParams.get("playlistId") });
  if (!result.explanation) return NextResponse.json({ error: result.expired ? "The rejected-candidate trace expired; aggregate insights are still available." : "Detailed explanations are unavailable for this track or generation.", expired: result.expired }, { status: 404 });
  return NextResponse.json(result);
}
