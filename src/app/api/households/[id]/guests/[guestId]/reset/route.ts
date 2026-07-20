import { NextResponse } from "next/server";
import { resetHouseholdGuestFeedback } from "@/lib/householdCollaboration";
import { householdApiError, householdApiUserId } from "@/lib/householdCollaboration/api";
export async function POST(_: Request, { params }: { params: { id: string; guestId: string } }) { const userId = householdApiUserId(); if (!userId) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 }); try { return NextResponse.json({ guest: await resetHouseholdGuestFeedback(userId, params.id, params.guestId) }); } catch (error) { return householdApiError(error); } }

