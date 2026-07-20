import { NextResponse } from "next/server";
import { aiRouteError, requireAiAdmin } from "@/ai/services/api";
import { listAiFeatures } from "@/ai/services/settingsService";
export const dynamic = "force-dynamic";
export async function GET() { try { await requireAiAdmin(); return NextResponse.json({ features: await listAiFeatures() }); } catch (error) { return aiRouteError(error); } }
