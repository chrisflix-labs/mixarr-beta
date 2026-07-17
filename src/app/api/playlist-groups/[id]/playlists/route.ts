import { NextResponse } from "next/server";
import { membershipPatchSchema } from "@/lib/playlistGroups/schemas";
import { addPlaylistsToGroup } from "@/lib/playlistGroups/service";
import { playlistGroupApiError, playlistGroupSession, playlistGroupUnauthorized } from "@/lib/playlistGroups/api";
export async function POST(request: Request, { params }: { params: { id: string } }) { const userId = playlistGroupSession(); if (!userId) return playlistGroupUnauthorized(); try { const input = membershipPatchSchema.parse(await request.json()); return NextResponse.json(await addPlaylistsToGroup(userId, params.id, input.playlistIds), { status: 201 }); } catch (error) { return playlistGroupApiError(error); } }
