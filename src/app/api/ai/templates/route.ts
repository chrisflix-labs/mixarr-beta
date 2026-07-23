import { NextResponse } from "next/server";
import { aiRouteError, requireAiPermissionedUser } from "@/ai/intelligence/api";
import { createAiRequestTemplate, listAiRequestTemplates } from "@/ai/intelligence/service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { try { const userId = await requireAiPermissionedUser(); return NextResponse.json(await listAiRequestTemplates(userId, new URL(request.url).searchParams.get("search") || "")); } catch (error) { return aiRouteError(error); } }
export async function POST(request: Request) { try { const userId = await requireAiPermissionedUser(); return NextResponse.json(await createAiRequestTemplate(userId, await request.json()), { status: 201 }); } catch (error) { return aiRouteError(error); } }
