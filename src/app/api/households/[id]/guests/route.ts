import { NextResponse } from "next/server";
import { createHouseholdGuest, getHousehold } from "@/lib/householdCollaboration";
import { householdApiError, householdApiUserId } from "@/lib/householdCollaboration/api";
export async function GET(_: Request, { params }: { params: { id: string } }) { const userId = householdApiUserId(); if (!userId) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 }); try { return NextResponse.json({ guests: (await getHousehold(userId, params.id))?.guests || [] }); } catch (error) { return householdApiError(error); } }
export async function POST(request: Request, { params }: { params: { id: string } }) { const userId = householdApiUserId(); if (!userId) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 }); try { return NextResponse.json({ guest: await createHouseholdGuest(userId, params.id, await request.json()) }, { status: 201 }); } catch (error) { return householdApiError(error); } }

