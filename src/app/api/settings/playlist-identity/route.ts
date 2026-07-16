import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const settings = await prisma.syncSettings.findUnique({ where: { userId }, select: { playlistIdentityLearningEnabled: true } });
  return NextResponse.json({ learningEnabled: settings?.playlistIdentityLearningEnabled !== false });
}

export async function PATCH(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const input = z.object({ learningEnabled: z.boolean() }).safeParse(await request.json().catch(() => ({})));
  if (!input.success) return NextResponse.json({ error: input.error.issues[0]?.message || "Invalid setting" }, { status: 400 });
  const settings = await prisma.syncSettings.upsert({ where: { userId }, create: { userId, playlistIdentityLearningEnabled: input.data.learningEnabled }, update: { playlistIdentityLearningEnabled: input.data.learningEnabled } });
  return NextResponse.json({ learningEnabled: settings.playlistIdentityLearningEnabled });
}
