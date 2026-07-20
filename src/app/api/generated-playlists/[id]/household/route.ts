import { NextResponse } from "next/server";
import { configureHouseholdPlaylist, getHouseholdPlaylistDetails } from "@/lib/householdCollaboration";
import { householdApiError, householdApiUserId } from "@/lib/householdCollaboration/api";
export async function GET(_: Request, { params }: { params: { id: string } }) { const userId = householdApiUserId(); if (!userId) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 }); try { const collaboration = await getHouseholdPlaylistDetails(userId, params.id); return collaboration ? NextResponse.json({ collaboration }) : NextResponse.json({ collaboration: null }, { status: 404 }); } catch (error) { return householdApiError(error); } }
export async function PUT(request: Request, { params }: { params: { id: string } }) { const userId = householdApiUserId(); if (!userId) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 }); try { const body = await request.json(); return NextResponse.json({ configuration: await configureHouseholdPlaylist(userId, params.id, body, body.generationSnapshot) }); } catch (error) { return householdApiError(error); } }

