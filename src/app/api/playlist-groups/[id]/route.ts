import { NextResponse } from "next/server";
import { updatePlaylistGroupSchema } from "@/lib/playlistGroups/schemas";
import { deletePlaylistGroup, getPlaylistGroup, updatePlaylistGroup } from "@/lib/playlistGroups/service";
import { playlistGroupApiError, playlistGroupSession, playlistGroupUnauthorized } from "@/lib/playlistGroups/api";

export async function GET(_: Request, { params }: { params: { id: string } }) { const userId = playlistGroupSession(); if (!userId) return playlistGroupUnauthorized(); try { return NextResponse.json({ group: await getPlaylistGroup(userId, params.id) }); } catch (error) { return playlistGroupApiError(error); } }
export async function PATCH(request: Request, { params }: { params: { id: string } }) { const userId = playlistGroupSession(); if (!userId) return playlistGroupUnauthorized(); try { const input = updatePlaylistGroupSchema.parse(await request.json()); return NextResponse.json({ group: await updatePlaylistGroup(userId, params.id, input) }); } catch (error) { return playlistGroupApiError(error); } }
export async function DELETE(_: Request, { params }: { params: { id: string } }) { const userId = playlistGroupSession(); if (!userId) return playlistGroupUnauthorized(); try { return NextResponse.json(await deletePlaylistGroup(userId, params.id)); } catch (error) { return playlistGroupApiError(error); } }
