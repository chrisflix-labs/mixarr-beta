import { NextResponse } from "next/server";
import { chainApiError, chainSession, chainUnauthorized, pagination } from "@/lib/playlistChains/api";
import { listChainVersions } from "@/lib/playlistChains";
export async function GET(request: Request, { params }: { params: { id: string } }) { const userId = chainSession(); if (!userId) return chainUnauthorized(); try { const { page, pageSize } = pagination(request); return NextResponse.json(await listChainVersions(userId, params.id, { page, pageSize })); } catch (error) { return chainApiError(error); } }

