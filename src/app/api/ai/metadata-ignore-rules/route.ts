import { NextResponse } from "next/server";
import { advisoryRouteError, advisoryUserId } from "@/lib/aiAdvisory/api";
import { createIgnoreRule, listIgnoreRules } from "@/lib/aiAdvisory/service";
export async function GET() { try { return NextResponse.json({ rules: await listIgnoreRules(advisoryUserId()) }); } catch (error) { return advisoryRouteError(error); } }
export async function POST(request: Request) { try { return NextResponse.json({ rule: await createIgnoreRule(advisoryUserId(), await request.json()) }, { status: 201 }); } catch (error) { return advisoryRouteError(error); } }

