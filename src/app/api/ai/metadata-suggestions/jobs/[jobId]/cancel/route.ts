import { NextResponse } from "next/server";
import { advisoryRouteError, advisoryUserId } from "@/lib/aiAdvisory/api";
import { cancelMetadataScan } from "@/lib/aiAdvisory/service";
export async function POST(_request: Request, { params }: { params: { jobId: string } }) { try { return NextResponse.json({ job: await cancelMetadataScan(advisoryUserId(), params.jobId) }); } catch (error) { return advisoryRouteError(error); } }

