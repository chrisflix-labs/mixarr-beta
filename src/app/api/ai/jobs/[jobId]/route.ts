import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { aiRouteError } from "@/ai/services/api";
import { getAiCapabilities } from "@/ai/governance/permissions";
import { getVisibleAiJob } from "@/ai/queue/service";
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: { jobId: string } }) { try { const userId = cookies().get("mixarr_session")?.value, capabilities = await getAiCapabilities(userId); if (!userId) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Authentication is required." } }, { status: 401 }); return NextResponse.json({ job: await getVisibleAiJob(params.jobId, userId, capabilities.permissions.includes("ai.audit.view")) }); } catch (error) { return aiRouteError(error); } }
