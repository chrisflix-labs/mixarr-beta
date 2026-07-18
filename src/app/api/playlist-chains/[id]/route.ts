import { NextResponse } from "next/server";
import { chainApiError, chainSession, chainUnauthorized } from "@/lib/playlistChains/api";
import { deletePlaylistChain, getPlaylistChain, updatePlaylistChain } from "@/lib/playlistChains";
export async function GET(_: Request, { params }: { params: { id: string } }) { const userId = chainSession(); if (!userId) return chainUnauthorized(); try { return NextResponse.json({ chain: await getPlaylistChain(userId, params.id) }); } catch (error) { return chainApiError(error); } }
export async function PATCH(request: Request, { params }: { params: { id: string } }) { const userId = chainSession(); if (!userId) return chainUnauthorized(); try { return NextResponse.json({ chain: await updatePlaylistChain(userId, params.id, await request.json()) }); } catch (error) { return chainApiError(error); } }
export async function DELETE(_: Request, { params }: { params: { id: string } }) { const userId = chainSession(); if (!userId) return chainUnauthorized(); try { return NextResponse.json(await deletePlaylistChain(userId, params.id)); } catch (error) { return chainApiError(error); } }

