import { NextResponse } from "next/server";
import { createHousehold, listHouseholds } from "@/lib/householdCollaboration";
import { householdApiError, householdApiUserId } from "@/lib/householdCollaboration/api";

export async function GET(request: Request) { const userId = householdApiUserId(); if (!userId) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 }); try { const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true"; return NextResponse.json({ households: await listHouseholds(userId, includeArchived) }); } catch (error) { return householdApiError(error); } }
export async function POST(request: Request) { const userId = householdApiUserId(); if (!userId) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 }); try { return NextResponse.json({ household: await createHousehold(userId, await request.json()) }, { status: 201 }); } catch (error) { return householdApiError(error); } }

