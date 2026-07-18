import { NextResponse } from "next/server";
import { chainApiError, chainSession, chainUnauthorized } from "@/lib/playlistChains/api";
import { reorderChainMembers } from "@/lib/playlistChains";
export async function POST(request: Request, { params }: { params: { id: string } }) { const userId = chainSession(); if (!userId) return chainUnauthorized(); try { const body = await request.json(); return NextResponse.json({ chain: await reorderChainMembers(userId, params.id, body.memberIds) }); } catch (error) { return chainApiError(error); } }

