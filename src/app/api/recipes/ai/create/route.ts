import { NextResponse } from "next/server";
import { runRecipeCopilot } from "@/lib/recipeCopilot/service";
import { recipeCopilotApiError, recipeCopilotUserId } from "@/lib/recipeCopilot/api";

export async function POST(request: Request) {
  try { const body = await request.json(); return NextResponse.json({ proposal: await runRecipeCopilot(recipeCopilotUserId(), null, { ...body, action: "create" }, request.signal) }, { status: 201 }); }
  catch (error) { return recipeCopilotApiError(error); }
}

