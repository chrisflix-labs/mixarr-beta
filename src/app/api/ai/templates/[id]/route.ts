import { NextResponse } from "next/server";
import { aiRouteError, requireAiPermissionedUser } from "@/ai/intelligence/api";
import { deleteAiRequestTemplate, updateAiRequestTemplate } from "@/ai/intelligence/service";
export async function PATCH(request: Request, { params }: { params: { id: string } }) { try { const userId = await requireAiPermissionedUser(); return NextResponse.json(await updateAiRequestTemplate(userId, params.id, await request.json())); } catch (error) { return aiRouteError(error); } }
export async function DELETE(_request: Request, { params }: { params: { id: string } }) { try { const userId = await requireAiPermissionedUser(); return NextResponse.json(await deleteAiRequestTemplate(userId, params.id)); } catch (error) { return aiRouteError(error); } }
