import { NextResponse } from "next/server";
import { chainApiError, chainSession, chainUnauthorized } from "@/lib/playlistChains/api";
import { syncMasterJourney } from "@/lib/playlistChains";
export async function POST(_: Request, { params }: { params: { id: string } }) { const userId = chainSession(); if (!userId) return chainUnauthorized(); try { return NextResponse.json(await syncMasterJourney(userId, params.id)); } catch (error) { return chainApiError(error); } }

