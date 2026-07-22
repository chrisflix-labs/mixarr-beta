import { NextResponse } from "next/server";
import { advisoryRouteError, advisoryUserId } from "@/lib/aiAdvisory/api";
import { deletePlaylistSummary, listPlaylistSummaries, updatePlaylistSummary } from "@/lib/aiAdvisory/service";
export async function GET(_request: Request, { params }: { params: { playlistId: string; summaryId: string } }) { try { const result = await listPlaylistSummaries(advisoryUserId(), params.playlistId, { includeArchived: true, pageSize: 100 }); const row = result.summaries.find((summary) => summary.id === params.summaryId); return row ? NextResponse.json({ summary: row }) : NextResponse.json({ error: { code: "SUMMARY_NOT_FOUND", message: "Playlist summary not found." } }, { status: 404 }); } catch (error) { return advisoryRouteError(error); } }
export async function PATCH(request: Request, { params }: { params: { playlistId: string; summaryId: string } }) { try { return NextResponse.json(await updatePlaylistSummary(advisoryUserId(), params.playlistId, params.summaryId, await request.json())); } catch (error) { return advisoryRouteError(error); } }
export async function DELETE(_request: Request, { params }: { params: { playlistId: string; summaryId: string } }) { try { return NextResponse.json(await deletePlaylistSummary(advisoryUserId(), params.playlistId, params.summaryId)); } catch (error) { return advisoryRouteError(error); } }

