import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { clearArtistFeedback, setArtistFeedback } from "@/lib/personalization";

function uid() { return cookies().get("mixarr_session")?.value; }
function failed(error: any) { const message = error?.issues?.[0]?.message || error?.message || "Artist feedback failed"; return NextResponse.json({ error: { code: error?.issues ? "INVALID_FEEDBACK" : "FEEDBACK_FAILED", message } }, { status: error?.issues ? 400 : message.includes("not found") ? 404 : 500 }); }
export async function POST(request: Request) { const userId = uid(); if (!userId) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 }); try { return NextResponse.json(await setArtistFeedback(userId, await request.json())); } catch (error) { return failed(error); } }
export async function DELETE(request: Request) { const userId = uid(); if (!userId) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 }); try { const body = await request.json(); return NextResponse.json(await clearArtistFeedback(userId, String(body.artistId || ""), body.sourceSurface)); } catch (error) { return failed(error); } }
