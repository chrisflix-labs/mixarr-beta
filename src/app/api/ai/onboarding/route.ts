import { NextResponse } from "next/server";
import { aiRouteError, requireAiAdmin } from "@/ai/services/api";
import { activateAiOnboarding, getAiOnboarding, saveAiOnboarding } from "@/ai/intelligence/service";
export const dynamic = "force-dynamic";
export async function GET() { try { const userId = await requireAiAdmin(); return NextResponse.json(await getAiOnboarding(userId)); } catch (error) { return aiRouteError(error); } }
export async function PATCH(request: Request) { try { const userId = await requireAiAdmin(); return NextResponse.json(await saveAiOnboarding(userId, await request.json())); } catch (error) { return aiRouteError(error); } }
export async function POST() { try { const userId = await requireAiAdmin(); return NextResponse.json(await activateAiOnboarding(userId)); } catch (error) { return aiRouteError(error); } }
