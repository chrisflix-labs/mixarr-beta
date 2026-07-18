import { NextResponse } from "next/server";
import { chainApiError, chainSession, chainUnauthorized } from "@/lib/playlistChains/api";
import { analyzePlaylistChain } from "@/lib/playlistChains";
export async function POST(_: Request, { params }: { params: { id: string } }) { const userId = chainSession(); if (!userId) return chainUnauthorized(); try { return NextResponse.json({ preview: await analyzePlaylistChain(userId, params.id) }); } catch (error) { return chainApiError(error); } }

