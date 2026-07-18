import { NextResponse } from "next/server";
import { chainApiError, chainSession, chainUnauthorized } from "@/lib/playlistChains/api";
import { removeChainMember, updateChainMember } from "@/lib/playlistChains";
export async function PATCH(request: Request, { params }: { params: { id: string; memberId: string } }) { const userId = chainSession(); if (!userId) return chainUnauthorized(); try { return NextResponse.json({ chain: await updateChainMember(userId, params.id, params.memberId, await request.json()) }); } catch (error) { return chainApiError(error); } }
export async function DELETE(_: Request, { params }: { params: { id: string; memberId: string } }) { const userId = chainSession(); if (!userId) return chainUnauthorized(); try { return NextResponse.json({ chain: await removeChainMember(userId, params.id, params.memberId) }); } catch (error) { return chainApiError(error); } }

