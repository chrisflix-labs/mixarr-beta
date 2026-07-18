import { NextResponse } from "next/server";
import { chainApiError, chainSession, chainUnauthorized, pagination } from "@/lib/playlistChains/api";
import { createPlaylistChain, listPlaylistChains } from "@/lib/playlistChains";
export async function GET(request: Request) { const userId = chainSession(); if (!userId) return chainUnauthorized(); try { const { url, page, pageSize } = pagination(request); return NextResponse.json(await listPlaylistChains(userId, { page, pageSize, status: url.searchParams.get("status") || undefined, query: url.searchParams.get("query") || undefined })); } catch (error) { return chainApiError(error); } }
export async function POST(request: Request) { const userId = chainSession(); if (!userId) return chainUnauthorized(); try { return NextResponse.json({ chain: await createPlaylistChain(userId, await request.json()) }, { status: 201 }); } catch (error) { return chainApiError(error); } }

