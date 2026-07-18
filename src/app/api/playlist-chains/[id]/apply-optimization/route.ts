import { NextResponse } from "next/server";
import { chainApiError, chainSession, chainUnauthorized } from "@/lib/playlistChains/api";
import { applyChainOptimization } from "@/lib/playlistChains";
export async function POST(request: Request, { params }: { params: { id: string } }) { const userId = chainSession(); if (!userId) return chainUnauthorized(); try { const body = await request.json(); return NextResponse.json(await applyChainOptimization(userId, params.id, body.previewId, body.selectedSuggestionIds || [])); } catch (error) { return chainApiError(error); } }

