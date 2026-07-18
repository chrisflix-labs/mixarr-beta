import { NextResponse } from "next/server";
import { chainApiError, chainSession, chainUnauthorized } from "@/lib/playlistChains/api";
import { addChainMember } from "@/lib/playlistChains";
export async function POST(request: Request, { params }: { params: { id: string } }) { const userId = chainSession(); if (!userId) return chainUnauthorized(); try { return NextResponse.json({ chain: await addChainMember(userId, params.id, await request.json()) }, { status: 201 }); } catch (error) { return chainApiError(error); } }

