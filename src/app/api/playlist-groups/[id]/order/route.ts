import { NextResponse } from "next/server";
import { reorderSchema } from "@/lib/playlistGroups/schemas";
import { reorderGroupPlaylists } from "@/lib/playlistGroups/service";
import { playlistGroupApiError, playlistGroupSession, playlistGroupUnauthorized } from "@/lib/playlistGroups/api";
export async function PATCH(request: Request, { params }: { params: { id: string } }) { const userId = playlistGroupSession(); if (!userId) return playlistGroupUnauthorized(); try { const input = reorderSchema.parse(await request.json()); return NextResponse.json(await reorderGroupPlaylists(userId, params.id, input.playlistIds)); } catch (error) { return playlistGroupApiError(error); } }
