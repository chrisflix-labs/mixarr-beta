import { NextResponse } from "next/server";
import { authorizeApiRequest, ecosystemStatus } from "@/lib/integrations/service";
import { integrationApiError } from "@/lib/integrations/api";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { try { const auth = await authorizeApiRequest(request, "widget.read"); const status = await ecosystemStatus(auth.userId); return NextResponse.json({ ...status, total: status.totalPlaylists, healthy: status.healthyPlaylists, degraded: status.degradedPlaylists, reconciliationRequired: status.pendingReconciliations, plexStatus: status.plexAvailable ? "available" : "unavailable", mountStatus: status.mountsAvailable ? "available" : "unavailable" }, { headers: { "Cache-Control": "private, max-age=15" } }); } catch (error) { return integrationApiError(error); } }
