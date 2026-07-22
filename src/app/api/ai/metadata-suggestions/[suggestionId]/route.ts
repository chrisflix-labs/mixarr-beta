import { NextResponse } from "next/server";
import { advisoryRouteError, advisoryUserId } from "@/lib/aiAdvisory/api";
import { getMetadataSuggestion } from "@/lib/aiAdvisory/service";
export async function GET(request: Request, { params }: { params: { suggestionId: string } }) { try { const url = new URL(request.url); return NextResponse.json(await getMetadataSuggestion(advisoryUserId(), params.suggestionId, Number(url.searchParams.get("page") || 1), Number(url.searchParams.get("pageSize") || 50))); } catch (error) { return advisoryRouteError(error); } }

