import { NextResponse } from "next/server";
import { advisoryRouteError, advisoryUserId } from "@/lib/aiAdvisory/api";
import { listMetadataSuggestions } from "@/lib/aiAdvisory/service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { try { return NextResponse.json(await listMetadataSuggestions(advisoryUserId(), new URL(request.url).searchParams)); } catch (error) { return advisoryRouteError(error); } }

