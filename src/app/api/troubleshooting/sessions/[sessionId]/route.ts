import { NextResponse } from "next/server";
import { troubleshootingApiError, troubleshootingUserId } from "@/lib/troubleshooting/api";
import { deleteTroubleshootingSession, getTroubleshootingSession, updateTroubleshootingSession } from "@/lib/troubleshooting/service";
export async function GET(_: Request, { params }: { params: { sessionId: string } }) { try { return NextResponse.json({ session: await getTroubleshootingSession(troubleshootingUserId(), params.sessionId) }); } catch (error) { return troubleshootingApiError(error); } }
export async function PATCH(request: Request, { params }: { params: { sessionId: string } }) { try { return NextResponse.json({ session: await updateTroubleshootingSession(troubleshootingUserId(), params.sessionId, await request.json()) }); } catch (error) { return troubleshootingApiError(error); } }
export async function DELETE(_: Request, { params }: { params: { sessionId: string } }) { try { return NextResponse.json(await deleteTroubleshootingSession(troubleshootingUserId(), params.sessionId)); } catch (error) { return troubleshootingApiError(error); } }
