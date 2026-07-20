import { NextResponse } from "next/server";
import { authorizeApiRequest, ecosystemStatus } from "@/lib/integrations/service";
import { integrationApiError } from "@/lib/integrations/api";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { try { const auth = await authorizeApiRequest(request, "home_assistant.read"); return NextResponse.json(await ecosystemStatus(auth.userId), { headers: { "Cache-Control": "private, max-age=15" } }); } catch (error) { return integrationApiError(error); } }
