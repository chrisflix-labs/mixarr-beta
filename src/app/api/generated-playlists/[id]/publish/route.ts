import { NextResponse } from "next/server";
import { publishApprovedHouseholdPlaylist } from "@/lib/householdCollaboration";
import { householdApiError, householdApiUserId } from "@/lib/householdCollaboration/api";
export async function POST(_: Request, { params }: { params: { id: string } }) { const userId = householdApiUserId(); if (!userId) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 }); try { return NextResponse.json(await publishApprovedHouseholdPlaylist(userId, params.id)); } catch (error) { return householdApiError(error); } }
