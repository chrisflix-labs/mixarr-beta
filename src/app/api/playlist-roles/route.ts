import { NextResponse } from "next/server";
import { chainApiError, chainSession, chainUnauthorized } from "@/lib/playlistChains/api";
import { createPlaylistRole, listPlaylistRoles } from "@/lib/playlistChains";
export async function GET() { const userId = chainSession(); if (!userId) return chainUnauthorized(); try { return NextResponse.json({ roles: await listPlaylistRoles(userId) }); } catch (error) { return chainApiError(error); } }
export async function POST(request: Request) { const userId = chainSession(); if (!userId) return chainUnauthorized(); try { return NextResponse.json({ role: await createPlaylistRole(userId, await request.json()) }, { status: 201 }); } catch (error) { return chainApiError(error); } }

