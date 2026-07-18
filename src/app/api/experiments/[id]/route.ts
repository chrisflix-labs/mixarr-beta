import { NextResponse } from "next/server";
import { deleteExperiment, getExperiment, updateExperiment } from "@/lib/experiments/service";
import { deleteExperimentSchema, updateExperimentSchema } from "@/lib/experiments/schemas";
import { experimentApiError, experimentUnauthorized, experimentUserId } from "@/lib/experiments/api";

export async function GET(_request: Request, { params }: { params: { id: string } }) { const userId = experimentUserId(); if (!userId) return experimentUnauthorized(); try { return NextResponse.json(await getExperiment(userId, params.id)); } catch (error) { return experimentApiError(error); } }
export async function PATCH(request: Request, { params }: { params: { id: string } }) { const userId = experimentUserId(); if (!userId) return experimentUnauthorized(); try { return NextResponse.json(await updateExperiment(userId, params.id, updateExperimentSchema.parse(await request.json()))); } catch (error) { return experimentApiError(error); } }
export async function DELETE(request: Request, { params }: { params: { id: string } }) { const userId = experimentUserId(); if (!userId) return experimentUnauthorized(); try { const parsed = deleteExperimentSchema.parse(await request.json()); return NextResponse.json(await deleteExperiment(userId, params.id, parsed.deletePlexPlaylists)); } catch (error) { return experimentApiError(error); } }
