import { NextResponse } from "next/server";
import { naturalLanguageApiError, naturalLanguageUserId } from "@/lib/naturalLanguageRequests/api";
import { executeApprovedNaturalLanguageRequest } from "@/lib/naturalLanguageRequests/service";
export async function POST(request: Request, { params }: { params: { id: string } }) { try { const body = await request.json().catch(() => ({})); return NextResponse.json(await executeApprovedNaturalLanguageRequest(naturalLanguageUserId(), params.id, body), { status: 201 }); } catch (error) { return naturalLanguageApiError(error); } }
