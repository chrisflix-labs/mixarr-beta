import { NextResponse } from "next/server";
import { authorizeApiRequest, ecosystemStatus } from "@/lib/integrations/service";
import { integrationApiError } from "@/lib/integrations/api";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { try { const auth = await authorizeApiRequest(request, "status.read"); const status = await ecosystemStatus(auth.userId); return NextResponse.json({ data: { playlists: { total: status.totalPlaylists, healthy: status.healthyPlaylists, degraded: status.degradedPlaylists }, reconciliations: { pending: status.pendingReconciliations }, automations: { active: status.activeAutomations, failed: status.failedAutomations }, integrations: { failures: status.recentIntegrationFailures }, plexAvailable: status.plexAvailable, mountsAvailable: status.mountsAvailable }, schemaVersion: "1" }); } catch (error) { return integrationApiError(error); } }
