import { NextResponse } from "next/server";
import { updateHouseholdGuest } from "@/lib/householdCollaboration";
import { householdApiError, householdApiUserId } from "@/lib/householdCollaboration/api";
export async function PATCH(request: Request, { params }: { params: { id: string; guestId: string } }) { const userId = householdApiUserId(); if (!userId) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 }); try { return NextResponse.json({ guest: await updateHouseholdGuest(userId, params.id, params.guestId, await request.json()) }); } catch (error) { return householdApiError(error); } }
export async function DELETE(_: Request, { params }: { params: { id: string; guestId: string } }) { const userId = householdApiUserId(); if (!userId) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 }); try { return NextResponse.json({ guest: await updateHouseholdGuest(userId, params.id, params.guestId, { isActive: false }) }); } catch (error) { return householdApiError(error); } }

