import { NextResponse } from "next/server";
import { membershipSettingsSchema } from "@/lib/playlistGroups/schemas";
import { removePlaylistFromGroup, updateMembershipSettings } from "@/lib/playlistGroups/service";
import { playlistGroupApiError, playlistGroupSession, playlistGroupUnauthorized } from "@/lib/playlistGroups/api";
export async function PATCH(request: Request, { params }: { params: { id: string; playlistId: string } }) { const userId = playlistGroupSession(); if (!userId) return playlistGroupUnauthorized(); try { const input = membershipSettingsSchema.parse(await request.json()); return NextResponse.json({ membership: await updateMembershipSettings(userId, params.id, params.playlistId, input) }); } catch (error) { return playlistGroupApiError(error); } }
export async function DELETE(_: Request, { params }: { params: { id: string; playlistId: string } }) { const userId = playlistGroupSession(); if (!userId) return playlistGroupUnauthorized(); try { return NextResponse.json(await removePlaylistFromGroup(userId, params.id, params.playlistId)); } catch (error) { return playlistGroupApiError(error); } }
