import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { setPlaylistFitFeedback } from "@/lib/personalization";
export async function POST(request: Request) { const userId = cookies().get("mixarr_session")?.value; if (!userId) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 }); try { return NextResponse.json(await setPlaylistFitFeedback(userId, await request.json())); } catch (error: any) { const message = error?.issues?.[0]?.message || error?.message || "Playlist-fit feedback failed"; return NextResponse.json({ error: { code: error?.issues ? "INVALID_FEEDBACK" : "FEEDBACK_FAILED", message } }, { status: error?.issues ? 400 : message.includes("not found") ? 404 : 500 }); } }
