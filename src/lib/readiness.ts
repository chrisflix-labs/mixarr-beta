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
  diagnostics?: Record<string, unknown>;
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

type ReadinessModelDelegate = {
  findFirst(args: any): Promise<unknown>;
};

type DatabaseReadinessClient = {
  $queryRaw(strings: TemplateStringsArray, ...values: any[]): Promise<unknown>;
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
  user: ReadinessModelDelegate;
  server: ReadinessModelDelegate;
  library: ReadinessModelDelegate;
  track: ReadinessModelDelegate;
  syncLog: ReadinessModelDelegate;
  jobHistory: ReadinessModelDelegate;
  workerHeartbeat: ReadinessModelDelegate;
  systemState: ReadinessModelDelegate;
};

const REQUIRED_CORE_MODEL_CHECKS: Array<{
  model: keyof Pick<DatabaseReadinessClient, "user" | "server" | "library" | "track" | "syncLog" | "jobHistory" | "workerHeartbeat" | "systemState">;
  table: string;
  args: Record<string, unknown>;
}> = [
  { model: "user", table: "User", args: { select: { id: true } } },
  { model: "server", table: "Server", args: { select: { id: true } } },
  { model: "library", table: "Library", args: { select: { id: true } } },
  { model: "track", table: "Track", args: { select: { id: true } } },
  { model: "syncLog", table: "SyncLog", args: { select: { id: true } } },
  { model: "jobHistory", table: "JobHistory", args: { select: { id: true } } },
  { model: "workerHeartbeat", table: "WorkerHeartbeat", args: { select: { workerId: true } } },
  { model: "systemState", table: "SystemState", args: { select: { key: true } } },
];

const loggedDatabaseReadinessMessages = new Set<string>();

function check(label: string, status: ReadinessStatus, summary: string, detail?: string | null, diagnostics?: Record<string, unknown>): ReadinessCheck {
  return {
    label,
    status,
    summary,
    detail: detail ? sanitizeErrorText(detail, 500) : null,
    ...(diagnostics ? { diagnostics } : {}),
  };
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

function debugReadinessLogsEnabled() {
  return boolEnv(process.env.READINESS_DEBUG) || boolEnv(process.env.MIXARR_READINESS_DEBUG);
}

function logDatabaseReadiness(level: "ok" | "warning" | "error", line: string) {
  if (level === "ok" && !debugReadinessLogsEnabled()) return;
  if (!debugReadinessLogsEnabled() && loggedDatabaseReadinessMessages.has(line)) return;
  loggedDatabaseReadinessMessages.add(line);
  if (level === "error") console.error(line);
  else if (level === "warning") console.warn(line);
  else console.log(line);
}

function errorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String((error as any).code) : "";
}

function isMissingTableError(error: unknown) {
  const message = sanitizeErrorText(error) || "";
  return errorCode(error) === "P2021" || /relation .* does not exist|table .* does not exist|undefined_table/i.test(message);
}

function isMissingColumnError(error: unknown) {
  const message = sanitizeErrorText(error) || "";
  return errorCode(error) === "P2022" || /column .* does not exist|undefined_column/i.test(message);
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

async function inspectMigrationState(db: DatabaseReadinessClient) {
  try {
    const metadataRows = await db.$queryRawUnsafe<Array<{ table_name: string }>>(
      `select table_name from information_schema.tables where table_schema = current_schema() and table_name = '_prisma_migrations' limit 1`,
    );
    if (!metadataRows.length) return { state: "unavailable" as const };

    const incompleteRows = await db.$queryRawUnsafe<Array<{ migration_name: string }>>(
      `select migration_name from "_prisma_migrations" where finished_at is null and rolled_back_at is null limit 5`,
    );
    if (incompleteRows.length > 0) {
      return {
        state: "incomplete" as const,
        migrations: incompleteRows.map((row) => row.migration_name).filter(Boolean),
      };
    }
    return { state: "verified" as const };
  } catch (error) {
    return { state: "unverified" as const, error: sanitizeErrorText(error) };
  }
}

export async function buildDatabaseReadinessCheck(db: DatabaseReadinessClient = prisma as any): Promise<ReadinessCheck> {
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (error) {
    logDatabaseReadiness("error", "[Readiness] Database check error reason=connection_failed");
    return check("Database", "Error", "Database is not reachable.", sanitizeErrorText(error), {
      connection: "failed",
    });
  }

  const verifiedCoreTables: string[] = [];
  for (const probe of REQUIRED_CORE_MODEL_CHECKS) {
    try {
      await db[probe.model].findFirst(probe.args);
      verifiedCoreTables.push(probe.table);
    } catch (error) {
      if (isMissingTableError(error)) {
        logDatabaseReadiness("error", `[Readiness] Database check error reason=missing_core_table table=${probe.table}`);
        return check("Database", "Error", "Database schema check found missing required tables.", null, {
          connection: "ok",
          coreTables: "failed",
          verifiedCoreTables,
          missingRequiredTables: [probe.table],
        });
      }
      if (isMissingColumnError(error)) {
        logDatabaseReadiness("error", `[Readiness] Database check error reason=incomplete_migration table=${probe.table}`);
        return check(
          "Database",
          "Error",
          "Database is reachable, but some migrations may be missing. Check container logs or run migrations.",
          sanitizeErrorText(error),
          {
            connection: "ok",
            coreTables: "failed",
            verifiedCoreTables,
            migrationState: "incomplete",
            failedCoreTable: probe.table,
          },
        );
      }

      logDatabaseReadiness("error", `[Readiness] Database check error reason=core_query_failed table=${probe.table}`);
      return check("Database", "Error", "Database schema check failed while querying required app tables.", sanitizeErrorText(error), {
        connection: "ok",
        coreTables: "failed",
        verifiedCoreTables,
        failedCoreTable: probe.table,
      });
    }
  }

  const migrationState = await inspectMigrationState(db);
  if (migrationState.state === "incomplete") {
    logDatabaseReadiness("warning", "[Readiness] Database check warning migrationState=incomplete");
    return check(
      "Database",
      "Warning",
      "Database is reachable, but some migrations may be missing. Check container logs or run migrations.",
      migrationState.migrations.length ? `Incomplete migrations: ${migrationState.migrations.join(", ")}` : null,
      {
        connection: "ok",
        coreTables: "verified",
        verifiedCoreTables,
        migrationState: "incomplete",
        incompleteMigrations: migrationState.migrations,
      },
    );
  }

  const diagnostics = {
    connection: "ok",
    coreTables: "verified",
    verifiedCoreTables,
    migrationState: migrationState.state,
  };
  logDatabaseReadiness("ok", "[Readiness] Database check OK coreTables=verified");
  return check("Database", "OK", "Database connection and schema checks passed.", null, diagnostics);
}

async function databaseCheck() {
  try {
    return await buildDatabaseReadinessCheck(prisma as any);
  } catch (error) {
    console.error("[Readiness] Database check failed unexpectedly", sanitizeErrorText(error));
    return check("Database", "Unknown", "Database readiness check could not complete. The app is still running.", sanitizeErrorText(error), {
      connection: "unknown",
    });
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
