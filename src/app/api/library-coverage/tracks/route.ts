import { NextResponse } from "next/server";
import { coverageApiError, coverageSession, coverageUnauthorized, numberParam } from "@/lib/libraryCoverageApi";
import { getCoverageTracks, type CoverageTrackView } from "@/lib/libraryCoverage";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { const userId = coverageSession(); if (!userId) return coverageUnauthorized(); try { const p = new URL(request.url).searchParams; return NextResponse.json({ data: await getCoverageTracks(userId, { libraryId: p.get("libraryId"), view: (p.get("view") || "all") as CoverageTrackView, search: p.get("search") || undefined, page: numberParam(p, "page", 1), pageSize: numberParam(p, "pageSize", 50), sort: p.get("sort") || undefined, direction: p.get("direction") === "asc" ? "asc" : "desc", genre: p.get("genre") || undefined, mood: p.get("mood") || undefined, decade: p.get("decade") || undefined }) }); } catch (error) { return coverageApiError(error); } }
