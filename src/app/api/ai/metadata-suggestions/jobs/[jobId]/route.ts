import { NextResponse } from "next/server";
import { advisoryRouteError, advisoryUserId } from "@/lib/aiAdvisory/api";
import { getMetadataJob } from "@/lib/aiAdvisory/service";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: { jobId: string } }) { try { return NextResponse.json({ job: await getMetadataJob(advisoryUserId(), params.jobId) }); } catch (error) { return advisoryRouteError(error); } }

