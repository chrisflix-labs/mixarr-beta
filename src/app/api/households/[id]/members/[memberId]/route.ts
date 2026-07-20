import { NextResponse } from "next/server";
import { removeHouseholdMember, updateHouseholdMember } from "@/lib/householdCollaboration";
import { householdApiError, householdApiUserId } from "@/lib/householdCollaboration/api";
export async function PATCH(request: Request, { params }: { params: { id: string; memberId: string } }) { const userId = householdApiUserId(); if (!userId) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 }); try { return NextResponse.json({ member: await updateHouseholdMember(userId, params.id, params.memberId, await request.json()) }); } catch (error) { return householdApiError(error); } }
export async function DELETE(_: Request, { params }: { params: { id: string; memberId: string } }) { const userId = householdApiUserId(); if (!userId) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 }); try { return NextResponse.json({ member: await removeHouseholdMember(userId, params.id, params.memberId) }); } catch (error) { return householdApiError(error); } }

