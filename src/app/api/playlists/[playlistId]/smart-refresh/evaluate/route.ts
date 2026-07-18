import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { evaluatePlaylistSmartRefresh } from "@/lib/smartRefresh";

export const maxDuration = 120;
export async function POST(_request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value; if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await evaluatePlaylistSmartRefresh({ userId, generatedPlaylistId: params.playlistId, triggerSource: "MANUAL_CHECK", force: true })); }
  catch (error) { const message = error instanceof Error ? error.message : "Smart Refresh evaluation failed"; return NextResponse.json({ error: message }, { status: /not found/i.test(message) ? 404 : 409 }); }
}
