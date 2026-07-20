import { NextResponse } from "next/server";
import { aiRouteError, requireAiAdmin } from "@/ai/services/api";
import { getAiGlobalSettings, updateAiGlobalSettings } from "@/ai/services/settingsService";
export const dynamic = "force-dynamic";
export async function GET() { try { await requireAiAdmin(); return NextResponse.json(await getAiGlobalSettings()); } catch (error) { return aiRouteError(error); } }
export async function PUT(request: Request) { try { const userId = await requireAiAdmin(); return NextResponse.json(await updateAiGlobalSettings(await request.json(), userId)); } catch (error) { return aiRouteError(error); } }
