import { NextResponse } from "next/server";
import { updatePlaylistParticipantExclusion } from "@/lib/householdCollaboration";
import { householdApiError, householdApiUserId } from "@/lib/householdCollaboration/api";
export async function PATCH(request: Request, { params }: { params: { id: string; participantId: string } }) { const userId = householdApiUserId(); if (!userId) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 }); try { return NextResponse.json({ collaboration: await updatePlaylistParticipantExclusion(userId, params.id, params.participantId, await request.json()) }); } catch (error) { return householdApiError(error); } }
