import { NextResponse } from "next/server"; import { intentApiError, intentUserId } from "@/lib/intentIntelligence/api"; import { createPreset, listPresets } from "@/lib/intentIntelligence/service";
export async function GET() { try { return NextResponse.json(await listPresets(intentUserId())); } catch (caught) { return intentApiError(caught); } }
export async function POST(request: Request) { try { return NextResponse.json({ preset: await createPreset(intentUserId(), await request.json()) }, { status: 201 }); } catch (caught) { return intentApiError(caught); } }
