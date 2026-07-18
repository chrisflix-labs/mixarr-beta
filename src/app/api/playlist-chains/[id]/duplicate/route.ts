import { NextResponse } from "next/server";
import { chainApiError, chainSession, chainUnauthorized } from "@/lib/playlistChains/api";
import { duplicatePlaylistChain } from "@/lib/playlistChains";
export async function POST(_: Request, { params }: { params: { id: string } }) { const userId = chainSession(); if (!userId) return chainUnauthorized(); try { return NextResponse.json({ chain: await duplicatePlaylistChain(userId, params.id) }, { status: 201 }); } catch (error) { return chainApiError(error); } }

