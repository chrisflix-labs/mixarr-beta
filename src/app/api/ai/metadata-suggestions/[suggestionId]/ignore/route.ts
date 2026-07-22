import { NextResponse } from "next/server";
import { advisoryRouteError, advisoryUserId } from "@/lib/aiAdvisory/api";
import { reviewMetadataSuggestion } from "@/lib/aiAdvisory/service";
export async function POST(request: Request, { params }: { params: { suggestionId: string } }) { try { return NextResponse.json(await reviewMetadataSuggestion(advisoryUserId(), params.suggestionId, { ...(await request.json()), action: "IGNORE" })); } catch (error) { return advisoryRouteError(error); } }

