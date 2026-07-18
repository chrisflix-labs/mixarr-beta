import { NextResponse } from "next/server";
import { coverageApiError, coverageSession, coverageUnauthorized, numberParam } from "@/lib/libraryCoverageApi";
import { getCoverageSegments } from "@/lib/libraryCoverage";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { const userId = coverageSession(); if (!userId) return coverageUnauthorized(); try { const p = new URL(request.url).searchParams; return NextResponse.json({ data: await getCoverageSegments(userId, { libraryId: p.get("libraryId"), dimension: p.get("dimension") || undefined, search: p.get("search") || undefined, page: numberParam(p, "page", 1), pageSize: numberParam(p, "pageSize", 50) }) }); } catch (error) { return coverageApiError(error); } }
