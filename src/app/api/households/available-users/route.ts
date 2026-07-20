import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { householdApiUserId } from "@/lib/householdCollaboration/api";
export async function GET() { const userId = householdApiUserId(); if (!userId) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 }); const users = await prisma.user.findMany({ select: { id: true, username: true, thumb: true }, orderBy: { username: "asc" }, take: 200 }); return NextResponse.json({ users }); }

