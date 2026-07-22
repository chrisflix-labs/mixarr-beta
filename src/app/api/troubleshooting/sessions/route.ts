import { NextResponse } from "next/server";
import { troubleshootingApiError, troubleshootingUserId } from "@/lib/troubleshooting/api";
import { createTroubleshootingSession, listTroubleshootingSessions } from "@/lib/troubleshooting/service";
export async function GET(request: Request) { try { const p = new URL(request.url).searchParams; return NextResponse.json(await listTroubleshootingSessions(troubleshootingUserId(), { page: Number(p.get("page") || 1), pageSize: Number(p.get("pageSize") || 20) })); } catch (error) { return troubleshootingApiError(error); } }
export async function POST(request: Request) { try { return NextResponse.json({ session: await createTroubleshootingSession(troubleshootingUserId(), await request.json()) }, { status: 201 }); } catch (error) { return troubleshootingApiError(error); } }
