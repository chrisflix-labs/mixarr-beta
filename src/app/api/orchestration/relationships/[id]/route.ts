import { NextResponse } from "next/server";
import { orchestrationApiError, orchestrationSession, orchestrationUnauthorized } from "@/lib/orchestration/api";
import { deleteManagedPlaylistRelationship } from "@/lib/orchestration/service";
export async function DELETE(_: Request, { params }: { params: { id: string } }) { const userId = orchestrationSession(); if (!userId) return orchestrationUnauthorized(); try { await deleteManagedPlaylistRelationship(userId, params.id, userId); return NextResponse.json({ deleted: true }); } catch (error) { return orchestrationApiError(error); } }
