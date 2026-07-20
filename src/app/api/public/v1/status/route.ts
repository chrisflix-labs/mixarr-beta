import { NextResponse } from "next/server";
import { authorizeApiRequest, ecosystemStatus } from "@/lib/integrations/service";
import { integrationApiError } from "@/lib/integrations/api";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { try { const auth = await authorizeApiRequest(request, "status.read"); return NextResponse.json({ data: await ecosystemStatus(auth.userId), schemaVersion: "1" }, { headers: { "X-RateLimit-Policy": "120 requests per minute", "Cache-Control": "private, max-age=15" } }); } catch (error) { return integrationApiError(error); } }
