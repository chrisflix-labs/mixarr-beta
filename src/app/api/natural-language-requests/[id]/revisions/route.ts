import { NextResponse } from "next/server";
import { naturalLanguageApiError, naturalLanguageUserId } from "@/lib/naturalLanguageRequests/api";
import { getNaturalLanguageRequest, reviseNaturalLanguageRequest } from "@/lib/naturalLanguageRequests/service";
export async function GET(_request: Request, { params }: { params: { id: string } }) { try { const value = await getNaturalLanguageRequest(naturalLanguageUserId(), params.id, true); return NextResponse.json({ revisions: value.revisions || [] }); } catch (error) { return naturalLanguageApiError(error); } }
export async function POST(request: Request, { params }: { params: { id: string } }) { try { return NextResponse.json({ request: await reviseNaturalLanguageRequest(naturalLanguageUserId(), params.id, await request.json()) }); } catch (error) { return naturalLanguageApiError(error); } }
