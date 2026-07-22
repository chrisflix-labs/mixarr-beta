import { NextResponse } from "next/server"; import { intentApiError, intentUserId } from "@/lib/intentIntelligence/api"; import { getIntentSettings, updateIntentSettings } from "@/lib/intentIntelligence/service";
export async function GET() { try { return NextResponse.json({ settings: await getIntentSettings(intentUserId()) }); } catch (caught) { return intentApiError(caught); } }
export async function PUT(request: Request) { try { return NextResponse.json({ settings: await updateIntentSettings(intentUserId(), await request.json()) }); } catch (caught) { return intentApiError(caught); } }
