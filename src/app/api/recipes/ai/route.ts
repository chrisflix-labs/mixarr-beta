import { NextResponse } from "next/server";
import { getRecipeCopilotAvailability, listRecipeCopilotHistory, runRecipeCopilot } from "@/lib/recipeCopilot/service";
import { recipeCopilotApiError, recipeCopilotUserId } from "@/lib/recipeCopilot/api";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("view") === "history") return NextResponse.json(await listRecipeCopilotHistory(recipeCopilotUserId(), null, Number(url.searchParams.get("page")) || 1, Number(url.searchParams.get("pageSize")) || 25));
    const recipe = url.searchParams.get("recipe") ? JSON.parse(url.searchParams.get("recipe")!) : undefined;
    return NextResponse.json(await getRecipeCopilotAvailability(recipeCopilotUserId(), { action: url.searchParams.get("action") || "create", recipe }));
  } catch (error) { return recipeCopilotApiError(error); }
}
export async function POST(request: Request) {
  try { return NextResponse.json({ proposal: await runRecipeCopilot(recipeCopilotUserId(), null, await request.json(), request.signal) }, { status: 201 }); }
  catch (error) { return recipeCopilotApiError(error); }
}

