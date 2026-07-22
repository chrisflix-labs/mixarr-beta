import { NextResponse } from "next/server";
import { advisoryRouteError, advisoryUserId } from "@/lib/aiAdvisory/api";
import { previewPlaylistSummaryRequest } from "@/lib/aiAdvisory/service";
export async function POST(request: Request, { params }: { params: { playlistId: string } }) { try { return NextResponse.json(await previewPlaylistSummaryRequest(advisoryUserId(), params.playlistId, await request.json())); } catch (error) { return advisoryRouteError(error); } }

