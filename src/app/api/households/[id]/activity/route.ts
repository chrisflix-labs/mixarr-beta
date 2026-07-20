import { NextResponse } from "next/server";
import { getHouseholdActivity } from "@/lib/householdCollaboration";
import { householdApiError, householdApiUserId } from "@/lib/householdCollaboration/api";
export async function GET(request: Request, { params }: { params: { id: string } }) { const userId = householdApiUserId(); if (!userId) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 }); try { const q = new URL(request.url).searchParams; return NextResponse.json(await getHouseholdActivity(userId, params.id, { page: Number(q.get("page") || 1), pageSize: Number(q.get("pageSize") || 25), eventType: q.get("eventType") || undefined, actorUserId: q.get("userId") || undefined, generatedPlaylistId: q.get("playlistId") || undefined, from: q.get("from") ? new Date(q.get("from")!) : undefined, to: q.get("to") ? new Date(q.get("to")!) : undefined })); } catch (error) { return householdApiError(error); } }

