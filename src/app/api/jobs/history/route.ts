import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { clearTerminalJobHistory } from "@/lib/jobHistory";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function DELETE() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return unauthorized();

  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return unauthorized();

    const deleted = await clearTerminalJobHistory({ userId: user.id });
    revalidatePath("/");
    revalidatePath("/jobs");
    revalidatePath("/job-history");

    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    console.error("[JobHistory] Failed to clear job history", error);
    return NextResponse.json({ ok: false, error: "Failed to clear job history." }, { status: 500 });
  }
}
