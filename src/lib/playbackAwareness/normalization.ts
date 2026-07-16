import { createHash } from "crypto";
import type { NormalizedPlaybackEvent } from "./types";

export const DEFAULT_COMPLETION_THRESHOLD = 0.9;
export const DEFAULT_SKIP_THRESHOLD = 0.35;
export const DEFAULT_MINIMUM_SKIP_DURATION_MS = 10_000;

const finite = (value: unknown) => {
  const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
};

function positiveInteger(value: unknown) {
  const parsed = finite(value);
  return parsed != null && parsed >= 0 ? Math.round(parsed) : null;
}

function eventDate(value: unknown) {
  const numeric = finite(value);
  if (numeric != null) {
    const date = new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric);
    if (!Number.isNaN(date.getTime())) return date;
  }
  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

function stableImportKey(parts: unknown[]) {
  return createHash("sha256").update(parts.map((part) => String(part ?? "")).join("|")).digest("hex");
}

export function normalizePlaybackEvent(input: {
  serverId: string;
  plexUserId: string;
  plexUsername?: string | null;
  item: Record<string, any>;
  completionThreshold?: number;
  skipThreshold?: number;
  minimumSkipDurationMs?: number;
  now?: Date;
}): NormalizedPlaybackEvent | null {
  const { item } = input;
  const playedAt = eventDate(item.viewedAt ?? item.playedAt ?? item.createdAt ?? item.timestamp);
  if (!playedAt) return null;

  const durationMs = positiveInteger(item.duration);
  const viewOffsetMs = positiveInteger(item.viewOffset ?? item.view_offset ?? item.playDuration);
  const rawPercent = finite(item.completionPercent);
  const completionPercent = rawPercent != null
    ? Math.max(0, Math.min(1, rawPercent > 1 ? rawPercent / 100 : rawPercent))
    : durationMs && viewOffsetMs != null
      ? Math.max(0, Math.min(1, viewOffsetMs / durationMs))
      : null;
  const completionThreshold = Math.max(0.5, Math.min(1, input.completionThreshold ?? DEFAULT_COMPLETION_THRESHOLD));
  const skipThreshold = Math.max(0.05, Math.min(completionThreshold, input.skipThreshold ?? DEFAULT_SKIP_THRESHOLD));
  const minimumSkipDurationMs = Math.max(1_000, input.minimumSkipDurationMs ?? DEFAULT_MINIMUM_SKIP_DURATION_MS);
  const explicitCompleted = item.completed === true || item.completed === 1 || item.completed === "1";
  const explicitSkip = item.skipped === true || item.skipped === 1 || String(item.event || item.type || "").toLowerCase() === "skip";
  const completed = explicitCompleted || (completionPercent != null && completionPercent >= completionThreshold);
  const safelyInferSkip = !completed
    && completionPercent != null
    && completionPercent > 0
    && completionPercent < skipThreshold
    && viewOffsetMs != null
    && viewOffsetMs >= minimumSkipDurationMs
    && playedAt.getTime() < (input.now ?? new Date()).getTime() - 5 * 60_000;
  const skipped = explicitSkip || safelyInferSkip;
  const plexRatingKey = item.ratingKey == null ? null : String(item.ratingKey);
  const plexLibraryId = item.librarySectionID ?? item.librarySectionId ?? item.libraryId;
  const suppliedKey = item.historyKey ?? item.sessionKey ?? item.eventKey ?? item.key;
  const importKey = stableImportKey([
    input.serverId,
    input.plexUserId,
    suppliedKey,
    plexRatingKey,
    playedAt.toISOString(),
    durationMs,
    viewOffsetMs,
  ]);

  return {
    importKey,
    serverId: input.serverId,
    plexLibraryId: plexLibraryId == null ? null : String(plexLibraryId),
    plexUserId: String(item.accountID ?? item.accountId ?? item.userID ?? input.plexUserId),
    plexUsername: String(item.username ?? item.accountName ?? input.plexUsername ?? "").trim() || null,
    plexRatingKey,
    playedAt,
    durationMs,
    viewOffsetMs,
    completionPercent,
    completed,
    skipped,
    playCountContribution: completed || viewOffsetMs != null ? 1 : 0.5,
    source: "plex_history",
    rawEventType: String(item.event ?? item.type ?? "history").trim() || null,
    raw: item,
  };
}
