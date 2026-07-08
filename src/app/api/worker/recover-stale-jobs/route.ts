import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { recoverStaleJobs } from "@/lib/workerHealth";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return unauthorized();

  try {
    const body = await request.json().catch(() => ({}));
    const requeueSafe = body?.requeueSafe !== false;
    const result = await recoverStaleJobs({ requeueSafe, trigger: "manual" });
    revalidatePath("/");
    revalidatePath("/job-history");
    revalidatePath("/data-enrichment");
    revalidatePath("/library-health");
    revalidatePath("/settings");
    revalidatePath("/settings/library-health");
    return NextResponse.json({
      status: "ok",
      message: `Recovered stale jobs: requeued ${result.requeued} safe jobs, marked ${result.interrupted + result.needsReview} job${result.interrupted + result.needsReview === 1 ? "" : "s"} as interrupted or needing review.`,
      result,
    });
  } catch (error) {
    console.error("[Worker] Failed to recover stale jobs", error);
    return NextResponse.json({ error: "Failed to recover stale jobs" }, { status: 500 });
  }
}
