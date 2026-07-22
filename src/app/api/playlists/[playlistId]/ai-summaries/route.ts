import { NextResponse } from "next/server";
import { advisoryRouteError, advisoryUserId } from "@/lib/aiAdvisory/api";
import { generatePlaylistSummaries, listPlaylistSummaries } from "@/lib/aiAdvisory/service";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: { playlistId: string } }) { try { const url = new URL(request.url); return NextResponse.json(await listPlaylistSummaries(advisoryUserId(), params.playlistId, { type: url.searchParams.get("type") || undefined, includeArchived: url.searchParams.get("includeArchived") === "true", page: Number(url.searchParams.get("page") || 1), pageSize: Number(url.searchParams.get("pageSize") || 25) })); } catch (error) { return advisoryRouteError(error); } }
export async function POST(request: Request, { params }: { params: { playlistId: string } }) { try { return NextResponse.json(await generatePlaylistSummaries(advisoryUserId(), params.playlistId, await request.json()), { status: 201 }); } catch (error) { return advisoryRouteError(error); } }

