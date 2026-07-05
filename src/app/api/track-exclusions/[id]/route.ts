import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deleted = await prisma.trackExclusion.deleteMany({
    where: {
      id: params.id,
      userId,
    },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ error: "Track exclusion not found" }, { status: 404 });
  }

  return NextResponse.json({ excluded: false });
}
