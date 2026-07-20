import { NextResponse } from "next/server";
import { previewHouseholdInfluence } from "@/lib/householdCollaboration";
import { householdApiError, householdApiUserId } from "@/lib/householdCollaboration/api";
export async function POST(request: Request) { const userId = householdApiUserId(); if (!userId) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 }); try { return NextResponse.json(await previewHouseholdInfluence(userId, await request.json())); } catch (error) { return householdApiError(error); } }

