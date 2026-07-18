import { NextResponse } from "next/server";
import { coverageApiError, coverageSession, coverageUnauthorized } from "@/lib/libraryCoverageApi";
import { getCoverageSummary, type CoveragePeriod } from "@/lib/libraryCoverage";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { const userId = coverageSession(); if (!userId) return coverageUnauthorized(); try { const url = new URL(request.url); const period = (["active", "30d", "90d", "12m", "all_time"].includes(url.searchParams.get("period") || "") ? url.searchParams.get("period") : "all_time") as CoveragePeriod; return NextResponse.json({ data: await getCoverageSummary(userId, { libraryId: url.searchParams.get("libraryId"), period }) }); } catch (error) { return coverageApiError(error); } }
