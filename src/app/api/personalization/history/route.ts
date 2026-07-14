import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getInteractionHistory, TRACK_INTERACTION_TYPES } from "@/lib/personalization";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  eventType: z.enum(TRACK_INTERACTION_TYPES).optional(),
});

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid pagination" }, { status: 400 });
  return NextResponse.json(await getInteractionHistory(userId, parsed.data));
}
