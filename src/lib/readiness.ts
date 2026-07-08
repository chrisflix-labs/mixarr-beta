import prisma from "./prisma";
import { APP_VERSION } from "./appVersion";
import { DEFAULT_GITHUB_REPO_URL, MIXARR_GITHUB_URL, validHttpUrl } from "./appInfo";
import { getResolvedSchedulerSettings, isValidSchedulerCron } from "./schedulerSettings";
import { getUserSyncSettings, resolveMetadataProviderSettings } from "./syncSettings";
import { getWorkerHealthSummary, isHeartbeatStale } from "./workerHealth";
import { sanitizeErrorText } from "./supportRedaction";

export type ReadinessStatus = "OK" | "Warning" | "Error" | "Disabled" | "Unknown";

export type ReadinessCheck = {
  label: string;
  status: ReadinessStatus;
  summary: string;
  detail?: string | null;
};

export type AppReadiness = {
  version: string;
  betaLabel: "Beta";
  releaseChannel: "beta";
  checkedAt: string;
  overallStatus: ReadinessStatus;
  checks: {
    database: ReadinessCheck;
    plex: ReadinessCheck;
    worker: ReadinessCheck;
    scheduler: ReadinessCheck;
    localAudioAnalysis: ReadinessCheck;
    supportLinks: ReadinessCheck;
    githubRepo: ReadinessCheck;
    environment: ReadinessCheck;
  };
  messages: string[];
};

const REQUIRED_TABLES = [
  "_prisma_migrations",
  "User",
  "Server",
  "Library",
  "Track",
  "SyncLog",
  "JobHistory",
  "WorkerHeartbeat",
  "SystemState",
];

function check(label: string, status: ReadinessStatus, summary: string, detail?: string | null): ReadinessCheck {
  return { label, status, summary, detail: detail ? sanitizeErrorText(detail, 500) : null };
}

function statusRank(status: ReadinessStatus) {
  if (status === "Error") return 4;
  if (status === "Warning") return 3;
  if (status === "Unknown") return 2;
  if (status === "Disabled") return 1;
  return 0;
}

function overallStatus(checks: Record<string, ReadinessCheck>): ReadinessStatus {
  return Object.values(checks).sort((left, right) => statusRank(right.status) - statusRank(left.status))[0]?.status || "Unknown";
}

function boolEnv(value: string | undefined) {
  return value ? ["1", "true", "yes", "on"].includes(value.trim().toLowerCase()) : false;
}

function supportLinkChecks() {
  const discordRaw = process.env.DISCORD_SUPPORT_URL || process.env.NEXT_PUBLIC_DISCORD_SUPPORT_URL || "";
  const discordValid = validHttpUrl(discordRaw);
  const githubRaw = process.env.GITHUB_REPO_URL || process.env.NEXT_PUBLIC_GITHUB_REPO_URL || MIXARR_GITHUB_URL;
  const githubValid = validHttpUrl(githubRaw);

  return {
    supportLinks: check(
      "Support Links",
      !discordRaw ? "Warning" : discordValid ? "OK" : "Warning",
      !discordRaw ? "Discord support link is not configured." : discordValid ? "Discord support link is configured." : "Discord support URL is invalid.",
    ),
    githubRepo: check(
      "GitHub Repo",
      githubValid ? "OK" : "Warning",
      githubValid ? "GitHub beta repo is configured." : "GitHub repo URL is missing or invalid.",
      githubValid || DEFAULT_GITHUB_REPO_URL,
    ),
  };
}

async function databaseCheck() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const tableList = REQUIRED_TABLES.map((table) => `'${table.replace(/'/g, "''")}'`).join(",");
    const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      `select table_name from information_schema.tables where table_schema = current_schema() and table_name in (${tableList})`,
    );
    const found = new Set(rows.map((row) => row.table_name));
    const missing = REQUIRED_TABLES.filter((table) => !found.has(table));
    if (missing.length > 0) {
      return check("Database", "Error", "Database is reachable, but required tables are missing.", `Missing: ${missing.join(", ")}`);
    }
    return check("Database", "OK", "Database is reachable and required tables are present.");
  } catch (error) {
    return check("Database", "Error", "Database is not reachable.", sanitizeErrorText(error));
  }
}

async function plexCheck(userId?: string | null) {
  try {
    const where = userId ? { userId } : {};
    const server = await prisma.server.findFirst({
      where,
      orderBy: { updatedAt: "desc" },
      select: { uri: true, accessToken: true },
    });

    if (!server) {
      return check("Plex", "Warning", "Plex is not configured. Plex sync will be unavailable until configured.");
    }
    if (!server.uri) {
      return check("Plex", "Warning", "Plex URL is missing. Plex sync will be unavailable until configured.");
    }
    if (!server.accessToken) {
      return check("Plex", "Warning", "Plex token missing. Plex sync will be unavailable until configured.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch(`${server.uri.replace(/\/$/, "")}/identity?X-Plex-Token=${encodeURIComponent(server.accessToken)}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      return check("Plex", response.ok ? "OK" : "Warning", response.ok ? "Plex is configured and reachable." : "Plex is configured but did not respond successfully.");
    } catch (error) {
      return check("Plex", "Warning", "Plex is configured, but the connection check failed.", sanitizeErrorText(error));
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return check("Plex", "Unknown", "Unable to inspect Plex configuration.", sanitizeErrorText(error));
  }
}

async function workerCheck() {
  try {
    const worker = await getWorkerHealthSummary();
    if (worker.status === "Stopped") return check("Background Worker", "Warning", "Background worker is stopped.");
    if (worker.status === "Stale" || worker.diagnostics?.staleWorker) return check("Background Worker", "Warning", "Background worker heartbeat is stale.");
    if (worker.status === "Unknown") return check("Background Worker", "Unknown", "Background worker status is unknown.");
    return check("Background Worker", "OK", `Background worker is ${worker.status.toLowerCase()}.`);
  } catch (error) {
    return check("Background Worker", "Unknown", "Unable to load worker status.", sanitizeErrorText(error));
  }
}

async function schedulerCheck(worker: ReadinessCheck) {
  try {
    const settings = await getResolvedSchedulerSettings();
    if (!settings.schedulerEnabled) return check("Scheduler", "Disabled", "Scheduler is disabled.");
    if (!isValidSchedulerCron(settings.schedulerCron)) {
      return check("Scheduler", "Error", "Scheduler cron schedule is invalid.", settings.schedulerCron);
    }
    if (worker.status !== "OK") {
      return check("Scheduler", "Warning", "Scheduler is enabled, but the background worker is not running cleanly.");
    }
    return check("Scheduler", "OK", `Scheduler is enabled (${settings.schedulerCron}).`);
  } catch (error) {
    return check("Scheduler", "Warning", "Unable to validate scheduler settings.", sanitizeErrorText(error));
  }
}

async function localAudioAnalysisCheck(userId?: string | null) {
  try {
    const userSettings = userId ? await getUserSyncSettings(userId).catch(() => ({})) : {};
    const settings = resolveMetadataProviderSettings(userSettings);
    const enabled = settings.audioFeatures.local || settings.bpm.local || boolEnv(process.env.ENABLE_LOCAL_AUDIO_FEATURES) || boolEnv(process.env.ENABLE_LOCAL_BPM);
    if (!enabled) return check("Local Audio Analysis", "Disabled", "Local audio analysis is disabled.");

    try {
      const { assertEssentiaAvailable } = await import("./localBpmEngine");
      await assertEssentiaAvailable();
      return check("Local Audio Analysis", "OK", "Local Essentia analysis is available.");
    } catch (error) {
      return check("Local Audio Analysis", "Warning", "Local analysis is enabled, but the analyzer is unavailable.", sanitizeErrorText(error));
    }
  } catch (error) {
    return check("Local Audio Analysis", "Unknown", "Unable to inspect local analysis settings.", sanitizeErrorText(error));
  }
}

function environmentCheck() {
  const warnings = [
    !process.env.DATABASE_URL ? "DATABASE_URL is missing." : null,
    process.env.NODE_ENV && !["development", "production", "test"].includes(process.env.NODE_ENV) ? `NODE_ENV is unusual: ${process.env.NODE_ENV}.` : null,
  ].filter(Boolean);
  return check("Environment", warnings.length > 0 ? "Warning" : "OK", warnings.length > 0 ? warnings.join(" ") : "Environment variables look sane.");
}

export function buildReadinessMessages(readiness: AppReadiness) {
  return Object.values(readiness.checks)
    .filter((entry) => entry.status === "Warning" || entry.status === "Error")
    .map((entry) => `[Readiness] ${entry.summary}`);
}

export function buildReadinessLogLine(readiness: AppReadiness) {
  const c = readiness.checks;
  const db = c.database.status === "OK" ? "ok" : c.database.status.toLowerCase();
  const plex = c.plex.status === "OK" ? "connected" : c.plex.summary.includes("not configured") ? "not_configured" : c.plex.status.toLowerCase();
  const worker = c.worker.status === "OK" ? "ok" : c.worker.status.toLowerCase();
  const scheduler = c.scheduler.status === "OK" ? "ok" : c.scheduler.status.toLowerCase();
  const localAnalysis = c.localAudioAnalysis.status === "OK" ? "enabled" : c.localAudioAnalysis.status.toLowerCase();
  const discord = c.supportLinks.summary.includes("not configured") ? "not_configured" : c.supportLinks.status.toLowerCase();
  return `[Readiness] Startup check completed database=${db} plex=${plex} worker=${worker} scheduler=${scheduler} localAnalysis=${localAnalysis} discord=${discord}`;
}

export async function getAppReadiness(options: { userId?: string | null } = {}): Promise<AppReadiness> {
  const [database, plex, worker, localAudioAnalysis] = await Promise.all([
    databaseCheck(),
    plexCheck(options.userId),
    workerCheck(),
    localAudioAnalysisCheck(options.userId),
  ]);
  const scheduler = await schedulerCheck(worker);
  const links = supportLinkChecks();
  const checks = {
    database,
    plex,
    worker,
    scheduler,
    localAudioAnalysis,
    supportLinks: links.supportLinks,
    githubRepo: links.githubRepo,
    environment: environmentCheck(),
  };
  const readiness = {
    version: APP_VERSION,
    betaLabel: "Beta" as const,
    releaseChannel: "beta" as const,
    checkedAt: new Date().toISOString(),
    overallStatus: overallStatus(checks),
    checks,
    messages: [] as string[],
  };
  readiness.messages = buildReadinessMessages(readiness);
  return readiness;
}

export async function runStartupReadinessCheck() {
  try {
    const readiness = await getAppReadiness();
    for (const message of readiness.messages) console.warn(message);
    console.log(buildReadinessLogLine(readiness));
    return readiness;
  } catch (error) {
    console.error("[Readiness] Startup check failed", sanitizeErrorText(error));
    return null;
  }
}

export function normalizeWorkerReadinessStatus(status: string | null | undefined, lastHeartbeatAt?: Date | string | null): ReadinessStatus {
  if (!status) return "Unknown";
  if (status === "Stopped") return "Warning";
  if (status === "Stale" || isHeartbeatStale(lastHeartbeatAt)) return "Warning";
  return "OK";
}
