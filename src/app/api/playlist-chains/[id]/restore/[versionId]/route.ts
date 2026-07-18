import { NextResponse } from "next/server";
import { chainApiError, chainSession, chainUnauthorized } from "@/lib/playlistChains/api";
import { restoreChainVersion } from "@/lib/playlistChains";
export async function POST(_: Request, { params }: { params: { id: string; versionId: string } }) { const userId = chainSession(); if (!userId) return chainUnauthorized(); try { return NextResponse.json(await restoreChainVersion(userId, params.id, params.versionId)); } catch (error) { return chainApiError(error); } }

