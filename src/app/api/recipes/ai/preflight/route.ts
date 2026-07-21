import { NextResponse } from "next/server";
import { getRecipeCopilotAvailability } from "@/lib/recipeCopilot/service";
import { recipeCopilotApiError, recipeCopilotUserId } from "@/lib/recipeCopilot/api";

export async function POST(request: Request) {
  try { return NextResponse.json(await getRecipeCopilotAvailability(recipeCopilotUserId(), await request.json())); }
  catch (error) { return recipeCopilotApiError(error); }
}

