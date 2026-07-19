export type EcosystemHealthState = "HEALTHY" | "WARNING" | "NEEDS_ATTENTION" | "CRITICAL" | "PAUSED" | "NOT_ENOUGH_DATA";

export function healthStateFor(input: {
  automationState?: string | null;
  plexAvailable?: boolean | null;
  snapshotStatus?: string | null;
  score?: number | null;
  criticalCount?: number | null;
  warningCount?: number | null;
}): EcosystemHealthState {
  if (input.automationState === "PAUSED") return "PAUSED";
  if (input.plexAvailable === false || input.automationState === "ERROR" || (input.criticalCount || 0) > 0 || input.snapshotStatus === "CRITICAL") return "CRITICAL";
  if (input.score == null && !input.snapshotStatus) return "NOT_ENOUGH_DATA";
  if (input.snapshotStatus === "ATTENTION" || (input.score != null && input.score < 60)) return "NEEDS_ATTENTION";
  if ((input.warningCount || 0) > 0 || (input.score != null && input.score < 80)) return "WARNING";
  return "HEALTHY";
}

export function overlapPercentage(shared: number, sizeA: number, sizeB: number) {
  const denominator = Math.min(Math.max(0, sizeA), Math.max(0, sizeB));
  return denominator ? Math.round((Math.max(0, shared) / denominator) * 10_000) / 100 : 0;
}

export function coveragePercentage(used: number, eligible: number) {
  return eligible > 0 ? Math.round((Math.max(0, used) / eligible) * 10_000) / 100 : null;
}

export function relationshipStrength(input: { track?: number | null; artist?: number | null; identity?: number | null; explicit?: boolean }) {
  if (input.explicit) return 100;
  const weighted = (input.track || 0) * 0.6 + (input.artist || 0) * 0.25 + (input.identity || 0) * 0.15;
  return Math.round(Math.min(100, Math.max(0, weighted)) * 100) / 100;
}

export function successRate(succeeded: number, failed: number) {
  const attempted = Math.max(0, succeeded) + Math.max(0, failed);
  return attempted ? Math.round((Math.max(0, succeeded) / attempted) * 10_000) / 100 : null;
}

export function timeRangeStart(range: string, now = new Date()) {
  const days = range === "7d" ? 7 : range === "90d" ? 90 : range === "all" ? null : 30;
  return days == null ? null : new Date(now.getTime() - days * 86_400_000);
}

export const REQUIRED_BACKUP_SECTIONS = [
  "playlistGroups", "playlistRelationships", "automationConfiguration", "smartActions", "experiments",
  "healthHistory", "auditLogs", "playlistVersions", "orchestrationPreferences",
] as const;

export function validateBackupManifest(value: unknown) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const sections = input.sections && typeof input.sections === "object" && !Array.isArray(input.sections) ? input.sections as Record<string, unknown> : {};
  const missingSections = REQUIRED_BACKUP_SECTIONS.filter((key) => !(key in sections));
  const corruptSections = Object.entries(sections).filter(([, section]) => section == null || (typeof section !== "object" && !Array.isArray(section))).map(([key]) => key);
  const errors = typeof input.schemaVersion === "string" || typeof input.schemaVersion === "number" ? [] : ["Backup schemaVersion is missing."];
  const warnings = missingSections.length ? [`${missingSections.length} orchestration section(s) are missing.`] : [];
  const estimatedRestoreScope = Object.values(sections).reduce<number>((total, section) => total + (Array.isArray(section) ? section.length : section && typeof section === "object" ? Object.keys(section).length : 0), 0);
  const restoreCompatible = errors.length === 0 && corruptSections.length === 0 && missingSections.length === 0;
  return { status: restoreCompatible ? "VALID" : errors.length || corruptSections.length ? "INVALID" : "WARNING", schemaVersion: input.schemaVersion == null ? null : String(input.schemaVersion), missingSections, corruptSections, warnings, errors, estimatedRestoreScope, restoreCompatible };
}

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  const blocked = /(token|secret|password|credential|authorization|cookie|session|accessToken|api.?key|encryption)/i;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !blocked.test(key)).map(([key, item]) => [key, redactSecrets(item)]));
}
