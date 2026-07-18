import { NextResponse } from "next/server";
import { chainApiError, chainSession, chainUnauthorized } from "@/lib/playlistChains/api";
import { queueChainAnalysis } from "@/lib/playlistChains";
export async function POST(_: Request, { params }: { params: { id: string } }) { const userId = chainSession(); if (!userId) return chainUnauthorized(); try { return NextResponse.json(await queueChainAnalysis(userId, params.id), { status: 202 }); } catch (error) { return chainApiError(error); } }

