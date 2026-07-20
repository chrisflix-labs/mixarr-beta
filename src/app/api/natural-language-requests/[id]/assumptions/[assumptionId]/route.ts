import { NextResponse } from "next/server";
import { naturalLanguageApiError, naturalLanguageUserId } from "@/lib/naturalLanguageRequests/api";
import { resolveNaturalLanguageAssumption } from "@/lib/naturalLanguageRequests/service";
export async function POST(request: Request, { params }: { params: { id: string; assumptionId: string } }) { try { return NextResponse.json({ request: await resolveNaturalLanguageAssumption(naturalLanguageUserId(), params.id, params.assumptionId, await request.json()) }); } catch (error) { return naturalLanguageApiError(error); } }
