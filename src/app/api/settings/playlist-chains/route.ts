import { NextResponse } from "next/server";
import { chainApiError, chainSession, chainUnauthorized } from "@/lib/playlistChains/api";
import { getChainSettings, updateChainSettings } from "@/lib/playlistChains";
export async function GET() { const userId = chainSession(); if (!userId) return chainUnauthorized(); try { return NextResponse.json(await getChainSettings(userId)); } catch (error) { return chainApiError(error); } }
export async function PUT(request: Request) { const userId = chainSession(); if (!userId) return chainUnauthorized(); try { return NextResponse.json(await updateChainSettings(userId, await request.json())); } catch (error) { return chainApiError(error); } }
