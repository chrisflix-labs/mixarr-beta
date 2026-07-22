import { NextResponse } from "next/server"; import { intentApiError, intentUserId } from "@/lib/intentIntelligence/api"; import { validateIntent } from "@/lib/intentIntelligence/service";
export async function POST(request: Request) { try { intentUserId(); return NextResponse.json(await validateIntent(await request.json())); } catch (caught) { return intentApiError(caught); } }
