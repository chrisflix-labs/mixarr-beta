import { NextResponse } from "next/server";
import { naturalLanguageApiError, naturalLanguageUserId } from "@/lib/naturalLanguageRequests/api";
import { createNaturalLanguageRequest, listNaturalLanguageRequests } from "@/lib/naturalLanguageRequests/service";

export async function GET(request: Request) { try { const userId = naturalLanguageUserId(); const url = new URL(request.url); return NextResponse.json(await listNaturalLanguageRequests(userId, { status: url.searchParams.get("status") || undefined, page: Number(url.searchParams.get("page")) || 1, pageSize: Number(url.searchParams.get("pageSize")) || 25 })); } catch (error) { return naturalLanguageApiError(error); } }
export async function POST(request: Request) { try { const userId = naturalLanguageUserId(); const result = await createNaturalLanguageRequest(userId, await request.json()); return NextResponse.json({ request: result }, { status: 201 }); } catch (error) { return naturalLanguageApiError(error); } }
