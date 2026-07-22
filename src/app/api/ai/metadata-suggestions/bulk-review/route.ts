import { NextResponse } from "next/server";
import { advisoryRouteError, advisoryUserId } from "@/lib/aiAdvisory/api";
import { bulkReviewMetadataSuggestions } from "@/lib/aiAdvisory/service";
export async function POST(request: Request) { try { return NextResponse.json(await bulkReviewMetadataSuggestions(advisoryUserId(), await request.json())); } catch (error) { return advisoryRouteError(error); } }

