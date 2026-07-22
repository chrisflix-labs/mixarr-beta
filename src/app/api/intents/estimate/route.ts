import { NextResponse } from "next/server"; import { intentApiError, intentUserId } from "@/lib/intentIntelligence/api"; import { estimateIntentCoverage } from "@/lib/intentIntelligence/service";
export async function POST(request: Request) { try { return NextResponse.json(await estimateIntentCoverage(intentUserId(), await request.json())); } catch (caught) { return intentApiError(caught); } }
