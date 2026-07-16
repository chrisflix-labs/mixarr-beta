import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const playlistId = url.searchParams.get("playlistId");
  const dimension = url.searchParams.get("dimension");
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 25));
  const where = { userId, ...(playlistId ? { playlistId } : {}), ...(dimension ? { dimension } : {}) };
  const [items, total] = await Promise.all([
    prisma.adaptivePreferenceStatistic.findMany({ where, orderBy: [{ confidence: "desc" }, { observationCount: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.adaptivePreferenceStatistic.count({ where }),
  ]);
  return NextResponse.json({ items, total, page, pageSize, pageCount: Math.ceil(total / pageSize) });
}
