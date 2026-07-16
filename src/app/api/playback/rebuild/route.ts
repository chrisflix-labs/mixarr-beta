import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isUserAdmin } from "@/lib/auth";
import { acquireJobLock, attachJobHistoryToLock, setJobPhase } from "@/lib/jobLock";
import { safeFinishJobHistory, safeStartJobHistory } from "@/lib/jobHistory";
import prisma from "@/lib/prisma";
import { rebuildPlaybackProfilesForUser } from "@/lib/playbackAwareness";

const schema = z.object({ scope: z.enum(["user", "all"]).default("user") });

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const value = schema.parse(await request.json());
    if (value.scope === "all" && !(await isUserAdmin(userId))) return NextResponse.json({ error: "Admin permission required" }, { status: 403 });
    const lock = acquireJobLock({ name: "Playback profile rebuild", keys: ["playback-profile-rebuild"], source: "manual" });
    if (!lock.acquired) return NextResponse.json({ error: "A playback profile rebuild is already running", activeJob: lock.activeJob }, { status: 409 });
    void (async () => {
      const job = await safeStartJobHistory({ userId, type: "playback_profile", name: "Playback profile rebuild", trigger: "manual", lockKey: lock.job.lockKey, workerId: lock.job.workerId });
      attachJobHistoryToLock(lock.job, job, "playback_profile");
      try {
        const targetUsers = value.scope === "all"
          ? await prisma.user.findMany({ select: { id: true } })
          : [{ id: userId }];
        let processed = 0;
        let events = 0;
        for (let index = 0; index < targetUsers.length; index += 1) {
          setJobPhase(lock.job, `Rebuilding playback profile ${index + 1}/${targetUsers.length}`);
          const result = await rebuildPlaybackProfilesForUser(targetUsers[index].id);
          processed += result.profilesUpdated;
          events += result.eventsProcessed;
        }
        await safeFinishJobHistory({ job, status: "completed", counts: { attempted: events, processed }, summary: `Rebuilt ${processed.toLocaleString()} playback profiles from ${events.toLocaleString()} events.` });
      } catch (error) {
        await safeFinishJobHistory({ job, status: "failed", error, summary: "Playback profile rebuild failed. Raw playback history was preserved." });
      } finally {
        lock.release();
      }
    })();
    return NextResponse.json({ started: true, job: lock.job }, { status: 202 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.issues?.[0]?.message || error?.message || "Could not start playback profile rebuild" }, { status: error?.issues ? 400 : 500 });
  }
}
