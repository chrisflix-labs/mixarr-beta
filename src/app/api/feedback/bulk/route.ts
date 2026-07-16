import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { applyBulkFeedback } from "@/lib/personalization";
export async function POST(request: Request) { const userId = cookies().get("mixarr_session")?.value; if (!userId) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 }); try { const result = await applyBulkFeedback(userId, await request.json()); return NextResponse.json(result, { status: result.partialFailure ? 207 : 200 }); } catch (error: any) { const message = error?.issues?.[0]?.message || error?.message || "Bulk feedback failed"; return NextResponse.json({ error: { code: error?.issues ? "INVALID_FEEDBACK" : "BULK_FEEDBACK_FAILED", message } }, { status: error?.issues ? 400 : 500 }); } }
