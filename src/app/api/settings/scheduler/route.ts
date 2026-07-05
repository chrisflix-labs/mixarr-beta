import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getBackgroundSchedulerRuntimeStatus, rescheduleBackgroundScheduler } from "@/lib/backgroundScheduler";
import { getResolvedSchedulerSettings, saveSchedulerSettings, SchedulerSettingsValidationError } from "@/lib/schedulerSettings";
import { calculateNextSchedulerRun, schedulerSummary } from "@/lib/schedulerSettingsCore";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

async function requireSession() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return null;
  return userId;
}

async function schedulerPayload() {
  const settings = await getResolvedSchedulerSettings();
  const lastRun = await prisma.jobHistory.findFirst({
    where: {
      trigger: "scheduled",
      name: "nightly sync pipeline",
    },
    orderBy: { startedAt: "desc" },
    select: {
      startedAt: true,
      finishedAt: true,
      status: true,
      summary: true,
    },
  });
  const nextRun = calculateNextSchedulerRun(settings);

  return {
    settings,
    status: {
      schedulerEnabled: settings.schedulerEnabled,
      currentSchedule: schedulerSummary(settings),
      currentCron: settings.schedulerCron,
      runtime: getBackgroundSchedulerRuntimeStatus(),
      lastRun: lastRun ? {
        startedAt: lastRun.startedAt.toISOString(),
        finishedAt: lastRun.finishedAt?.toISOString() ?? null,
        status: lastRun.status,
        summary: lastRun.summary,
      } : null,
      nextRun: nextRun?.toISOString() ?? null,
    },
  };
}

export async function GET() {
  if (!await requireSession()) return unauthorized();
  return NextResponse.json(await schedulerPayload());
}

export async function PUT(req: Request) {
  if (!await requireSession()) return unauthorized();

  try {
    const body = await req.json();
    const settings = await saveSchedulerSettings(body);
    await rescheduleBackgroundScheduler(settings);

    return NextResponse.json({
      ...(await schedulerPayload()),
      message: "Scheduler settings saved. New schedule is active.",
    });
  } catch (error) {
    if (error instanceof SchedulerSettingsValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[SchedulerSettings] Failed to save scheduler settings", error);
    return NextResponse.json({ error: "Failed to save scheduler settings." }, { status: 500 });
  }
}
