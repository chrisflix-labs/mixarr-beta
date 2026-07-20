import { NextResponse } from "next/server";
import { naturalLanguageApiError, naturalLanguageUserId } from "@/lib/naturalLanguageRequests/api";
import { reinterpretNaturalLanguageRequest } from "@/lib/naturalLanguageRequests/service";
export async function POST(_request: Request, { params }: { params: { id: string } }) { try { return NextResponse.json({ request: await reinterpretNaturalLanguageRequest(naturalLanguageUserId(), params.id) }); } catch (error) { return naturalLanguageApiError(error); } }
