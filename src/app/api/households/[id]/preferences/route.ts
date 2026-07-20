import { NextResponse } from "next/server";
import { getHousehold, setHouseholdPreference } from "@/lib/householdCollaboration";
import { householdApiError, householdApiUserId } from "@/lib/householdCollaboration/api";
export async function GET(_: Request, { params }: { params: { id: string } }) { const userId = householdApiUserId(); if (!userId) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 }); try { return NextResponse.json({ preferences: (await getHousehold(userId, params.id))?.preferences || [] }); } catch (error) { return householdApiError(error); } }
export async function POST(request: Request, { params }: { params: { id: string } }) { const userId = householdApiUserId(); if (!userId) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 }); try { return NextResponse.json({ preference: await setHouseholdPreference(userId, params.id, await request.json()) }); } catch (error) { return householdApiError(error); } }

