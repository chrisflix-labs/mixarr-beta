import { NextResponse } from "next/server";
import { coverageApiError, coverageSession, coverageUnauthorized, numberParam } from "@/lib/libraryCoverageApi";
import { getArtistCoverage } from "@/lib/libraryCoverage";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { const userId = coverageSession(); if (!userId) return coverageUnauthorized(); try { const p = new URL(request.url).searchParams; return NextResponse.json({ data: await getArtistCoverage(userId, { libraryId: p.get("libraryId"), search: p.get("search") || undefined, page: numberParam(p, "page", 1), pageSize: numberParam(p, "pageSize", 50), usage: (p.get("usage") || "all") as any }) }); } catch (error) { return coverageApiError(error); } }
