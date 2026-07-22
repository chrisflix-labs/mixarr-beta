import { NextResponse } from "next/server";
import { advisoryRouteError, advisoryUserId } from "@/lib/aiAdvisory/api";
import { metadataSuggestionStats } from "@/lib/aiAdvisory/service";
export const dynamic = "force-dynamic";
export async function GET() { try { return NextResponse.json(await metadataSuggestionStats(advisoryUserId())); } catch (error) { return advisoryRouteError(error); } }

