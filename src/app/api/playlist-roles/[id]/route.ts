import { NextResponse } from "next/server";
import { chainApiError, chainSession, chainUnauthorized } from "@/lib/playlistChains/api";
import { deletePlaylistRole, updatePlaylistRole } from "@/lib/playlistChains";
export async function PATCH(request: Request, { params }: { params: { id: string } }) { const userId = chainSession(); if (!userId) return chainUnauthorized(); try { return NextResponse.json({ role: await updatePlaylistRole(userId, params.id, await request.json()) }); } catch (error) { return chainApiError(error); } }
export async function DELETE(_: Request, { params }: { params: { id: string } }) { const userId = chainSession(); if (!userId) return chainUnauthorized(); try { return NextResponse.json(await deletePlaylistRole(userId, params.id)); } catch (error) { return chainApiError(error); } }

