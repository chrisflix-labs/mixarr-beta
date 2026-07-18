import { NextResponse } from "next/server";
import { chainApiError, chainSession, chainUnauthorized } from "@/lib/playlistChains/api";
import { updateChainHandoff } from "@/lib/playlistChains";
export async function PATCH(request: Request, { params }: { params: { id: string; handoffId: string } }) { const userId = chainSession(); if (!userId) return chainUnauthorized(); try { return NextResponse.json({ chain: await updateChainHandoff(userId, params.id, params.handoffId, await request.json()) }); } catch (error) { return chainApiError(error); } }

