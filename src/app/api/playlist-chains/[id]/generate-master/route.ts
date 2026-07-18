import { NextResponse } from "next/server";
import { chainApiError, chainSession, chainUnauthorized } from "@/lib/playlistChains/api";
import { generateMasterJourney } from "@/lib/playlistChains";
export async function POST(request: Request, { params }: { params: { id: string } }) { const userId = chainSession(); if (!userId) return chainUnauthorized(); try { return NextResponse.json(await generateMasterJourney(userId, params.id, await request.json())); } catch (error) { return chainApiError(error); } }

