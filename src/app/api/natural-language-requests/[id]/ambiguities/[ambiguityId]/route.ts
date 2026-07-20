import { NextResponse } from "next/server";
import { naturalLanguageApiError, naturalLanguageUserId } from "@/lib/naturalLanguageRequests/api";
import { resolveNaturalLanguageAmbiguity } from "@/lib/naturalLanguageRequests/service";
export async function POST(request: Request, { params }: { params: { id: string; ambiguityId: string } }) { try { return NextResponse.json({ request: await resolveNaturalLanguageAmbiguity(naturalLanguageUserId(), params.id, params.ambiguityId, await request.json()) }); } catch (error) { return naturalLanguageApiError(error); } }
