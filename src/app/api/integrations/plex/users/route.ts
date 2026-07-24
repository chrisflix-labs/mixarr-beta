import { NextResponse } from "next/server";
import { integrationApiError, requireIntegrationAdmin } from "@/lib/integrations/api";
import { discoverPlexUsers, removePlexUserMapping, savePlexUserMapping } from "@/lib/integrations/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireIntegrationAdmin();
    return NextResponse.json(await discoverPlexUsers(userId), {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return integrationApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const actorUserId = await requireIntegrationAdmin();
    const mapping = await savePlexUserMapping(actorUserId, await request.json());
    return NextResponse.json({ mapping });
  } catch (error) {
    return integrationApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const actorUserId = await requireIntegrationAdmin();
    return NextResponse.json(await removePlexUserMapping(actorUserId, await request.json()));
  } catch (error) {
    return integrationApiError(error);
  }
}
