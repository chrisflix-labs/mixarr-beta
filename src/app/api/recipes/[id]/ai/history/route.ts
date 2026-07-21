import { NextResponse } from "next/server";
import { listRecipeCopilotHistory } from "@/lib/recipeCopilot/service";
import { recipeCopilotApiError, recipeCopilotUserId } from "@/lib/recipeCopilot/api";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try { const url = new URL(request.url); return NextResponse.json(await listRecipeCopilotHistory(recipeCopilotUserId(), params.id, Number(url.searchParams.get("page")) || 1, Number(url.searchParams.get("pageSize")) || 25)); }
  catch (error) { return recipeCopilotApiError(error); }
}

