import { z } from "zod";

export const AUTOMATION_PERMISSION_LEVELS = ["DISABLED", "SUGGEST_ONLY", "REQUIRE_APPROVAL", "FULLY_AUTOMATIC"] as const;
export const AUTOMATION_PRESETS = ["CONSERVATIVE", "BALANCED", "AGGRESSIVE", "CUSTOM"] as const;
export const AUTOMATION_SOURCES = ["RECENTLY_ADDED", "SCHEDULED_REGENERATION", "PLAYLIST_IMPROVEMENT", "METADATA_REANALYSIS", "USER_REQUESTED", "APPROVAL_QUEUE", "API_REQUEST"] as const;

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time such as 22:00.");
const limit = z.coerce.number().int().min(0).max(100_000);

export const automationPolicySchema = z.object({
  permissionLevel: z.enum(AUTOMATION_PERMISSION_LEVELS),
  preset: z.enum(AUTOMATION_PRESETS),
  isCustom: z.boolean(),
  allowAdditions: z.boolean(),
  allowRemovals: z.boolean(),
  allowReorder: z.boolean(),
  maximumAdditionsPerUpdate: limit.max(500),
  maximumRemovalsPerUpdate: limit.max(500),
  minimumAdditionConfidence: limit.max(100),
  minimumRemovalConfidence: limit.max(100),
  maximumChangesPerDay: limit,
  maximumChangesPerWeek: limit,
  maximumAdditionsPerDay: limit,
  maximumRemovalsPerDay: limit,
  maximumAdditionsPerWeek: limit,
  maximumRemovalsPerWeek: limit,
  quietHoursEnabled: z.boolean(),
  quietHoursStart: timeSchema,
  quietHoursEnd: timeSchema,
  timezone: z.string().trim().min(1).max(100).refine((value) => isValidTimezone(value), "Use a valid IANA time zone."),
  quietHoursDaysJson: z.array(z.number().int().min(0).max(6)).max(7).nullable(),
  allowAnalysisDuringQuietHours: z.boolean(),
  allowProposalsDuringQuietHours: z.boolean(),
  requireApprovalForRegeneration: z.boolean(),
  paused: z.boolean(),
  pauseReason: z.string().trim().max(500).nullable(),
});

export type AutomationPolicy = z.infer<typeof automationPolicySchema>;

export const automationPolicyUpdateSchema = automationPolicySchema.partial().omit({ paused: true, pauseReason: true }).superRefine((value, ctx) => {
  if (value.allowRemovals && value.maximumRemovalsPerUpdate === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["maximumRemovalsPerUpdate"], message: "Set a removal limit above zero or turn automatic removals off." });
  }
});

export const PRESET_POLICIES: Record<Exclude<(typeof AUTOMATION_PRESETS)[number], "CUSTOM">, Partial<AutomationPolicy>> = {
  CONSERVATIVE: {
    permissionLevel: "SUGGEST_ONLY", allowAdditions: false, allowRemovals: false, allowReorder: false,
    maximumAdditionsPerUpdate: 0, maximumRemovalsPerUpdate: 0, minimumAdditionConfidence: 90, minimumRemovalConfidence: 95,
    maximumChangesPerDay: 0, maximumChangesPerWeek: 0, maximumAdditionsPerDay: 0, maximumRemovalsPerDay: 0,
    maximumAdditionsPerWeek: 0, maximumRemovalsPerWeek: 0, requireApprovalForRegeneration: true,
  },
  BALANCED: {
    permissionLevel: "FULLY_AUTOMATIC", allowAdditions: true, allowRemovals: false, allowReorder: false,
    maximumAdditionsPerUpdate: 3, maximumRemovalsPerUpdate: 0, minimumAdditionConfidence: 85, minimumRemovalConfidence: 92,
    maximumChangesPerDay: 10, maximumChangesPerWeek: 50, maximumAdditionsPerDay: 10, maximumRemovalsPerDay: 0,
    maximumAdditionsPerWeek: 50, maximumRemovalsPerWeek: 0, requireApprovalForRegeneration: true,
  },
  AGGRESSIVE: {
    permissionLevel: "FULLY_AUTOMATIC", allowAdditions: true, allowRemovals: true, allowReorder: true,
    maximumAdditionsPerUpdate: 10, maximumRemovalsPerUpdate: 5, minimumAdditionConfidence: 70, minimumRemovalConfidence: 80,
    maximumChangesPerDay: 40, maximumChangesPerWeek: 150, maximumAdditionsPerDay: 30, maximumRemovalsPerDay: 10,
    maximumAdditionsPerWeek: 120, maximumRemovalsPerWeek: 30, requireApprovalForRegeneration: false,
  },
};

export function isValidTimezone(timezone: string) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); return true; } catch { return false; }
}

export function policyForPreset(preset: keyof typeof PRESET_POLICIES, base: AutomationPolicy): AutomationPolicy {
  return automationPolicySchema.parse({ ...base, ...PRESET_POLICIES[preset], preset, isCustom: false });
}

export type AutomationCandidate = {
  id: string;
  trackId?: string | null;
  confidence?: number | null;
  protected?: boolean;
  locked?: boolean;
  important?: boolean;
  metadataComplete?: boolean;
};

export type AutomationPolicyInput = {
  policy: unknown;
  source: (typeof AUTOMATION_SOURCES)[number];
  now?: Date;
  protectedPlaylist?: boolean;
  playlistPaused?: boolean;
  additions?: AutomationCandidate[];
  removals?: AutomationCandidate[];
  reorderCount?: number;
  approvalGranted?: boolean;
  usedToday?: { additions: number; removals: number; reorders?: number };
  usedThisWeek?: { additions: number; removals: number; reorders?: number };
};

export type AutomationPolicyDecision = {
  allowed: boolean;
  requiresApproval: boolean;
  reasonCode: string;
  summary: string;
  allowedAdditions: number;
  allowedRemovals: number;
  allowedReorders: number;
  eligibleAdditionIds: string[];
  eligibleRemovalIds: string[];
  blockedTrackIds: string[];
  warnings: string[];
  skipped: Array<{ candidateId: string; trackId?: string | null; action: "ADD" | "REMOVE"; reasonCode: string }>;
  policySnapshot: Record<string, unknown>;
  eligibleAfter: string | null;
};

function localParts(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return { minutes: Number(get("hour")) * 60 + Number(get("minute")), day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")) };
}

export function quietHoursState(policy: AutomationPolicy, now = new Date()) {
  if (!policy.quietHoursEnabled || policy.quietHoursStart === policy.quietHoursEnd) return { active: false, eligibleAfter: null };
  const { minutes, day } = localParts(now, policy.timezone);
  const [startHour, startMinute] = policy.quietHoursStart.split(":").map(Number);
  const [endHour, endMinute] = policy.quietHoursEnd.split(":").map(Number);
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  const configuredDays = policy.quietHoursDaysJson;
  const crossesMidnight = start > end;
  const startDay = crossesMidnight && minutes < end ? (day + 6) % 7 : day;
  const onConfiguredDay = !configuredDays?.length || configuredDays.includes(startDay);
  const active = onConfiguredDay && (crossesMidnight ? minutes >= start || minutes < end : minutes >= start && minutes < end);
  if (!active) return { active: false, eligibleAfter: null };
  const minutesUntilEnd = crossesMidnight ? (minutes >= start ? 1440 - minutes + end : end - minutes) : end - minutes;
  return { active: true, eligibleAfter: new Date(now.getTime() + minutesUntilEnd * 60_000).toISOString() };
}

function total(usage: { additions: number; removals: number; reorders?: number }) {
  return usage.additions + usage.removals + (usage.reorders || 0);
}

export function evaluateAutomationPolicy(input: AutomationPolicyInput): AutomationPolicyDecision {
  const parsed = automationPolicySchema.safeParse(input.policy);
  const empty = (reasonCode: string, summary: string, snapshot: Record<string, unknown> = {}, requiresApproval = false, warnings: string[] = []): AutomationPolicyDecision => ({
    allowed: false, requiresApproval, reasonCode, summary, allowedAdditions: 0, allowedRemovals: 0, allowedReorders: 0,
    eligibleAdditionIds: [], eligibleRemovalIds: [], blockedTrackIds: [], warnings, skipped: [], policySnapshot: snapshot, eligibleAfter: null,
  });
  if (!parsed.success) return empty("policy_invalid", "Automation was blocked because the policy is missing or invalid.", {}, false, parsed.error.issues.map((issue) => issue.message));
  const policy = parsed.data;
  const snapshot = { ...policy, evaluatedAt: (input.now || new Date()).toISOString(), source: input.source };
  if (policy.paused) return empty("automation_paused", policy.pauseReason ? `Automation is paused: ${policy.pauseReason}` : "Automation is paused.", snapshot);
  if (input.playlistPaused) return empty("automation_paused", "Automation is paused for this playlist.", snapshot);
  if (policy.permissionLevel === "DISABLED") return empty("automation_disabled", "Automation is disabled. No proposal or Plex change was created.", snapshot);
  if (input.protectedPlaylist) return empty("protected_playlist", "This playlist is protected. Results may only be reviewed as suggestions.", snapshot);
  const quiet = quietHoursState(policy, input.now);
  if (quiet.active) {
    const result = empty("quiet_hours_active", "Plex changes are delayed while quiet hours are active.", snapshot);
    result.eligibleAfter = quiet.eligibleAfter;
    return result;
  }

  const additions = [...(input.additions || [])].sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1));
  const removals = [...(input.removals || [])].sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1));
  const usedToday = input.usedToday || { additions: 0, removals: 0, reorders: 0 };
  const usedThisWeek = input.usedThisWeek || { additions: 0, removals: 0, reorders: 0 };
  let remainingTotalDay = Math.max(0, policy.maximumChangesPerDay - total(usedToday));
  let remainingTotalWeek = Math.max(0, policy.maximumChangesPerWeek - total(usedThisWeek));
  let remainingAdds = Math.min(policy.maximumAdditionsPerUpdate, Math.max(0, policy.maximumAdditionsPerDay - usedToday.additions), Math.max(0, policy.maximumAdditionsPerWeek - usedThisWeek.additions), remainingTotalDay, remainingTotalWeek);
  const skipped: AutomationPolicyDecision["skipped"] = [];
  const eligibleAdditionIds: string[] = [];
  for (const item of additions) {
    let reason: string | null = null;
    if (!policy.allowAdditions) reason = "maximum_additions_reached";
    else if (item.metadataComplete === false || item.confidence == null) reason = "missing_required_metadata";
    else if (item.confidence < policy.minimumAdditionConfidence) reason = "below_confidence_threshold";
    else if (remainingAdds <= 0) reason = usedToday.additions >= policy.maximumAdditionsPerDay || remainingTotalDay <= 0 ? "daily_limit_reached" : usedThisWeek.additions >= policy.maximumAdditionsPerWeek || remainingTotalWeek <= 0 ? "weekly_limit_reached" : "maximum_additions_reached";
    if (reason) skipped.push({ candidateId: item.id, trackId: item.trackId, action: "ADD", reasonCode: reason });
    else { eligibleAdditionIds.push(item.id); remainingAdds -= 1; remainingTotalDay -= 1; remainingTotalWeek -= 1; }
  }
  let remainingRemovals = Math.min(policy.maximumRemovalsPerUpdate, Math.max(0, policy.maximumRemovalsPerDay - usedToday.removals), Math.max(0, policy.maximumRemovalsPerWeek - usedThisWeek.removals), remainingTotalDay, remainingTotalWeek);
  const eligibleRemovalIds: string[] = [];
  for (const item of removals) {
    let reason: string | null = null;
    if (item.protected) reason = "protected_track";
    else if (item.locked || item.important) reason = "locked_track";
    else if (!policy.allowRemovals) reason = "maximum_removals_reached";
    else if (item.metadataComplete === false || item.confidence == null) reason = "missing_required_metadata";
    else if (item.confidence < policy.minimumRemovalConfidence) reason = "below_confidence_threshold";
    else if (remainingRemovals <= 0) reason = usedToday.removals >= policy.maximumRemovalsPerDay || remainingTotalDay <= 0 ? "daily_limit_reached" : usedThisWeek.removals >= policy.maximumRemovalsPerWeek || remainingTotalWeek <= 0 ? "weekly_limit_reached" : "maximum_removals_reached";
    if (reason) skipped.push({ candidateId: item.id, trackId: item.trackId, action: "REMOVE", reasonCode: reason });
    else { eligibleRemovalIds.push(item.id); remainingRemovals -= 1; remainingTotalDay -= 1; remainingTotalWeek -= 1; }
  }
  const allowedReorders = policy.allowReorder && remainingTotalDay > 0 && remainingTotalWeek > 0 ? Math.min(input.reorderCount || 0, 1) : 0;
  const blockedTrackIds = Array.from(new Set(skipped.filter((item) => item.reasonCode === "protected_track" || item.reasonCode === "locked_track").map((item) => item.trackId).filter((id): id is string => Boolean(id))));
  const proposed = additions.length + removals.length + (input.reorderCount || 0);
  const allowedCount = eligibleAdditionIds.length + eligibleRemovalIds.length + allowedReorders;
  const warnings = Array.from(new Set(skipped.map((item) => item.reasonCode)));
  if (policy.permissionLevel === "SUGGEST_ONLY" && !input.approvalGranted) {
    const result = empty("suggest_only_mode", "Changes were saved as suggestions; Plex was not modified.", snapshot, false, warnings);
    return { ...result, blockedTrackIds, skipped };
  }
  const regenerationApproval = input.source === "SCHEDULED_REGENERATION" && policy.requireApprovalForRegeneration;
  if ((policy.permissionLevel === "REQUIRE_APPROVAL" || regenerationApproval) && !input.approvalGranted) {
    const result = empty("approval_required", "An authorized user must approve these changes before Plex is modified.", snapshot, true, warnings);
    return { ...result, allowedAdditions: eligibleAdditionIds.length, allowedRemovals: eligibleRemovalIds.length, allowedReorders, eligibleAdditionIds, eligibleRemovalIds, blockedTrackIds, skipped };
  }
  if (proposed > 0 && allowedCount === 0) {
    const reasonCode = warnings.includes("daily_limit_reached") ? "daily_limit_reached" : warnings.includes("weekly_limit_reached") ? "weekly_limit_reached" : warnings[0] || "policy_invalid";
    const result = empty(reasonCode, "No proposed changes passed the active automation policy.", snapshot, false, warnings);
    return { ...result, blockedTrackIds, skipped };
  }
  return {
    allowed: allowedCount > 0, requiresApproval: false, reasonCode: allowedCount < proposed ? "partially_allowed" : "allowed",
    summary: allowedCount < proposed ? `${allowedCount} of ${proposed} proposed changes passed the policy.` : `${allowedCount} proposed change${allowedCount === 1 ? "" : "s"} passed the policy.`,
    allowedAdditions: eligibleAdditionIds.length, allowedRemovals: eligibleRemovalIds.length, allowedReorders,
    eligibleAdditionIds, eligibleRemovalIds, blockedTrackIds, warnings, skipped, policySnapshot: snapshot, eligibleAfter: null,
  };
}

export function plainLanguagePolicySummary(policy: AutomationPolicy) {
  const lines = [
    policy.permissionLevel === "DISABLED" ? "Mixarr will not run automation." : policy.permissionLevel === "SUGGEST_ONLY" ? "Mixarr will create suggestions but will not edit Plex." : policy.permissionLevel === "REQUIRE_APPROVAL" ? "Mixarr will wait for approval before editing Plex." : "Mixarr may edit Plex when every policy rule passes.",
    policy.allowAdditions ? `Add up to ${policy.maximumAdditionsPerUpdate} tracks per update at ${policy.minimumAdditionConfidence}% confidence or higher.` : "Never add tracks automatically.",
    policy.allowRemovals ? `Remove up to ${policy.maximumRemovalsPerUpdate} tracks per update at ${policy.minimumRemovalConfidence}% confidence or higher; protected and locked tracks remain safe.` : "Never remove tracks automatically.",
    `Allow at most ${policy.maximumChangesPerDay} changes per day and ${policy.maximumChangesPerWeek} per week.`,
    policy.quietHoursEnabled ? `Delay Plex writes from ${policy.quietHoursStart} to ${policy.quietHoursEnd} (${policy.timezone}).` : "Quiet hours are off.",
  ];
  return lines;
}
