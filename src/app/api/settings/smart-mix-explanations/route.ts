import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { getExplanationPreference, updateExplanationPreference } from "@/lib/smartMixExplanations/service";

const schema = z.object({ enabled: z.boolean().optional(), detailLevel: z.enum(["SIMPLE", "DETAILED", "DEVELOPER"]).optional(), rejectedCandidateLimit: z.coerce.number().int().min(0).max(500).optional(), rejectedRetentionDays: z.coerce.number().int().min(1).max(365).optional() });

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [preference, user] = await Promise.all([getExplanationPreference(userId), prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } })]);
  return NextResponse.json({ preference, developerModeAvailable: Boolean(user?.isAdmin) });
}

export async function PATCH(req: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid explanation preference" }, { status: 400 });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  const preference = await updateExplanationPreference(userId, parsed.data, Boolean(user?.isAdmin));
  return NextResponse.json({ preference });
}
