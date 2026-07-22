import { NextResponse } from "next/server";
import { advisoryRouteError, advisoryUserId } from "@/lib/aiAdvisory/api";
import { getAdvisorySettings, updateAdvisorySettings } from "@/lib/aiAdvisory/service";
export async function GET() { try { return NextResponse.json({ settings: await getAdvisorySettings(advisoryUserId()) }); } catch (error) { return advisoryRouteError(error); } }
export async function PUT(request: Request) { try { return NextResponse.json({ settings: await updateAdvisorySettings(advisoryUserId(), await request.json()) }); } catch (error) { return advisoryRouteError(error); } }

