import { NextResponse } from "next/server";
import { naturalLanguageApiError, naturalLanguageUserId } from "@/lib/naturalLanguageRequests/api";
import { previewNaturalLanguageRequest } from "@/lib/naturalLanguageRequests/service";
export async function POST(request: Request) { try { return NextResponse.json(await previewNaturalLanguageRequest(naturalLanguageUserId(), await request.json())); } catch (error) { return naturalLanguageApiError(error); } }
