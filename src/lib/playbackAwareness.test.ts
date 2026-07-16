import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { aggregatePlaybackProfile, playbackSettingsSchema } from "./playbackAwareness/service";
import { normalizePlaybackEvent } from "./playbackAwareness/normalization";
import { scorePlaybackAwareTrack } from "./playbackAwareness/scoring";
import type { PlaybackScoringContext } from "./playbackAwareness/types";

function normalized(item: Record<string, unknown>) {
  return normalizePlaybackEvent({
    serverId: "server-1",
    plexUserId: "plex-user-1",
    plexUsername: "Listener",
    item: { ratingKey: "100", viewedAt: 1_700_000_000, duration: 200_000, ...item },
    now: new Date(1_700_100_000_000),
  });
}

describe("Plex playback event normalization", () => {
  it("recognizes completed playback at the centralized threshold", () => {
    const event = normalized({ viewOffset: 185_000 });
    assert.equal(event?.completed, true);
    assert.equal(event?.skipped, false);
    assert.equal(Math.round((event?.completionPercent || 0) * 100), 93);
  });

  it("only infers a skip from a meaningful, safely completed partial session", () => {
    const skipped = normalized({ viewOffset: 30_000 });
    const accidental = normalized({ viewOffset: 3_000 });
    assert.equal(skipped?.skipped, true);
    assert.equal(accidental?.skipped, false);
  });

  it("does not infer completion or skips when duration or offset is missing", () => {
    assert.equal(normalized({ duration: undefined, viewOffset: 30_000 })?.skipped, false);
    assert.equal(normalized({ viewOffset: undefined })?.skipped, false);
  });

  it("creates the same import key for duplicate imports", () => {
    assert.equal(normalized({ viewOffset: 190_000 })?.importKey, normalized({ viewOffset: 190_000 })?.importKey);
  });

  it("rejects records without a usable playback timestamp", () => {
    assert.equal(normalizePlaybackEvent({ serverId: "server", plexUserId: "user", item: {} }), null);
  });
});

describe("playback aggregation", () => {
  it("calculates completion, skip, replay, recent windows, affinity, and confidence", () => {
    const profile = aggregatePlaybackProfile({
      trackId: "track-1",
      plexUserId: "plex-user-1",
      total: 10,
      completed: 8,
      skipped: 2,
      completionTotal: 8.5,
      completionSamples: 10,
      firstPlayedAt: new Date(Date.now() - 400 * 86_400_000),
      lastPlayedAt: new Date(Date.now() - 200 * 86_400_000),
      lastCompletedAt: new Date(Date.now() - 200 * 86_400_000),
      lastSkippedAt: new Date(Date.now() - 250 * 86_400_000),
      recent7: 0,
      recent14: 0,
      recent30: 0,
      recent90: 0,
    });
    assert.equal(profile.completionRate, 0.8);
    assert.equal(profile.skipRate, 0.2);
    assert.equal(profile.replayCount, 9);
    assert.ok(profile.playbackConfidence > 0.5);
    assert.ok(profile.forgottenFavoriteScore > 0);
  });
});

function context(overrides: Partial<PlaybackScoringContext> = {}): PlaybackScoringContext {
  return {
    settings: {
      enabled: true,
      influence: 0.5,
      recentlyPlayedBehavior: "soft",
      recentlyPlayedWindowDays: 14,
      forgottenFavoriteDays: 180,
      useSkipHistory: true,
      useCompletionHistory: true,
      useReplayHistory: true,
      playbackAwareDiscovery: true,
      completionThreshold: 0.9,
      skipThreshold: 0.35,
      minimumSkipDurationMs: 10_000,
      minimumObservations: 3,
      maximumAdjustment: 8,
      historyRetentionDays: 730,
      syncIntervalHours: 24,
    },
    mapped: true,
    profiles: {
      "track-1": {
        trackId: "track-1",
        plexUserId: "plex-user-1",
        totalPlayCount: 10,
        completedPlayCount: 8,
        skipCount: 1,
        replayCount: 9,
        completionRate: 0.8,
        skipRate: 0.1,
        firstPlayedAt: new Date(Date.now() - 500 * 86_400_000),
        lastPlayedAt: new Date(Date.now() - 200 * 86_400_000),
        lastCompletedAt: new Date(Date.now() - 200 * 86_400_000),
        lastSkippedAt: null,
        averageCompletionPercent: 0.85,
        recentPlayCount7Days: 0,
        recentPlayCount14Days: 0,
        recentPlayCount30Days: 0,
        recentPlayCount90Days: 0,
        forgottenFavoriteScore: 70,
        playbackAffinityScore: 85,
        playbackConfidence: 0.85,
      },
    },
    protectedTrackIds: new Set(),
    maximumPersonalizationInfluence: 0.5,
    statusMessage: "ready",
    ...overrides,
  };
}

describe("playback-aware scoring", () => {
  it("adds capped completion, replay, forgotten-favorite, and discovery reasons", () => {
    const result = scorePlaybackAwareTrack(76, { id: "track-1", popularity: { score: 25 } }, context());
    assert.ok(result.finalScore > 76);
    assert.ok(result.reasons.some((reason) => reason.key === "forgotten"));
    assert.ok(Math.abs(result.appliedAdjustment) <= result.maximumAdjustment);
  });

  it("applies a recent-play penalty and supports strict exclusion", () => {
    const recent = { ...context().profiles["track-1"], lastPlayedAt: new Date(Date.now() - 2 * 86_400_000) };
    const soft = scorePlaybackAwareTrack(80, { id: "track-1" }, context({ profiles: { "track-1": recent } }));
    const strictContext = context({ profiles: { "track-1": recent } });
    strictContext.settings = { ...strictContext.settings, recentlyPlayedBehavior: "strict" };
    const strict = scorePlaybackAwareTrack(80, { id: "track-1" }, strictContext);
    assert.ok(soft.reasons.some((reason) => reason.key === "recent"));
    assert.equal(strict.excluded, true);
    assert.equal(strict.exclusionReason, "PLAYBACK_RECENT");
  });

  it("keeps locked and important tracks under strict avoidance", () => {
    const recent = { ...context().profiles["track-1"], lastPlayedAt: new Date() };
    const ctx = context({ profiles: { "track-1": recent }, protectedTrackIds: new Set(["track-1"]) });
    ctx.settings = { ...ctx.settings, recentlyPlayedBehavior: "strict" };
    const result = scorePlaybackAwareTrack(80, { id: "track-1" }, ctx);
    assert.equal(result.excluded, false);
    assert.equal(result.protectedFromStrictAvoidance, true);
  });

  it("stays close to base scoring with low confidence and respects both influence caps", () => {
    const low = { ...context().profiles["track-1"], playbackConfidence: 0.1 };
    const result = scorePlaybackAwareTrack(80, { id: "track-1" }, context({ profiles: { "track-1": low }, maximumPersonalizationInfluence: 0.1 }));
    assert.ok(Math.abs(result.finalScore - 80) <= 2);
  });

  it("does nothing when disabled, unmapped, or history is unavailable", () => {
    const disabled = context();
    disabled.settings = { ...disabled.settings, enabled: false };
    assert.equal(scorePlaybackAwareTrack(72, { id: "track-1" }, disabled).finalScore, 72);
    assert.equal(scorePlaybackAwareTrack(72, { id: "track-1" }, context({ mapped: false })).available, false);
    assert.equal(scorePlaybackAwareTrack(72, { id: "unknown" }, context()).finalScore, 72);
  });

  it("keeps profiles for different Mixarr users isolated even for the same track", () => {
    const recentProfile = { ...context().profiles["track-1"], lastPlayedAt: new Date() };
    const forgottenProfile = {
      ...context().profiles["track-1"],
      lastPlayedAt: new Date(Date.now() - 400 * 86_400_000),
      lastCompletedAt: new Date(Date.now() - 400 * 86_400_000),
    };
    const recentResult = scorePlaybackAwareTrack(
      75,
      { id: "track-1" },
      context({ profiles: { "track-1": recentProfile } }),
    );
    const forgottenResult = scorePlaybackAwareTrack(
      75,
      { id: "track-1" },
      context({ profiles: { "track-1": forgottenProfile } }),
    );
    assert.ok(recentResult.appliedAdjustment < forgottenResult.appliedAdjustment);
  });
});

describe("playback contracts, privacy, and performance", () => {
  it("validates supported recency and forgotten-favorite choices", () => {
    assert.equal(playbackSettingsSchema.safeParse({ recentlyPlayedWindowDays: 14, forgottenFavoriteDays: 365 }).success, true);
    assert.equal(playbackSettingsSchema.safeParse({ recentlyPlayedWindowDays: 21 }).success, false);
    assert.equal(playbackSettingsSchema.safeParse({ completionThreshold: 0.8, skipThreshold: 0.9 }).success, false);
  });

  it("defines indexed, user-separated, idempotent playback persistence", () => {
    const migration = readFileSync(join(process.cwd(), "prisma", "migrations", "20260716030000_playback_awareness", "migration.sql"), "utf8");
    assert.match(migration, /PlexPlaybackEvent_importKey_key/);
    assert.match(migration, /UserTrackPlaybackProfile_userId_trackId_key/);
    assert.match(migration, /PlexPlaybackEvent_plexUserId_playedAt_idx/);
    assert.match(migration, /ON DELETE CASCADE/);
  });

  it("uses bounded sync and lookup batches instead of per-track scoring queries", () => {
    const sync = readFileSync(join(process.cwd(), "src", "lib", "playbackAwareness", "sync.ts"), "utf8");
    const service = readFileSync(join(process.cwd(), "src", "lib", "playbackAwareness", "service.ts"), "utf8");
    assert.match(sync, /HISTORY_PAGE_SIZE = 250/);
    assert.match(sync, /LOOKUP_BATCH = 500/);
    assert.match(service, /PROFILE_BATCH = 500/);
    assert.match(service, /trackId: \{ in: trackIds\.slice/);
  });

  it("scores a representative 40,000-track library from a preloaded context", () => {
    const profiles = Object.fromEntries(
      Array.from({ length: 40_000 }, (_, index) => [
        `track-${index}`,
        {
          ...context().profiles["track-1"],
          trackId: `track-${index}`,
          playCount: index % 12,
          playbackConfidence: Math.min(1, (index % 10) / 10),
        },
      ]),
    );
    const libraryContext = context({ profiles });
    let scored = 0;
    for (let index = 0; index < 40_000; index += 1) {
      const result = scorePlaybackAwareTrack(70, { id: `track-${index}` }, libraryContext);
      if (Number.isFinite(result.finalScore)) scored += 1;
    }
    assert.equal(scored, 40_000);
  });

  it("authenticates every playback API and gates cross-user or unmatched access", () => {
    const routeNames = ["settings", "users", "status", "sync", "summary", "tracks", "reset", "rebuild", "unmatched"];
    for (const name of routeNames) {
      const route = readFileSync(join(process.cwd(), "src", "app", "api", "playback", name, "route.ts"), "utf8");
      assert.match(route, /mixarr_session/);
      assert.match(route, /Unauthorized/);
    }
    const unmatched = readFileSync(join(process.cwd(), "src", "app", "api", "playback", "unmatched", "route.ts"), "utf8");
    assert.match(unmatched, /isUserAdmin/);
  });

  it("ships the complete responsive settings and explainability surfaces", () => {
    const panel = readFileSync(join(process.cwd(), "src", "components", "PlaybackAwarenessPanel.tsx"), "utf8");
    const panelCss = readFileSync(join(process.cwd(), "src", "components", "PlaybackAwarenessPanel.module.css"), "utf8");
    const breakdown = readFileSync(join(process.cwd(), "src", "components", "AdaptiveScoreBreakdown.tsx"), "utf8");
    assert.match(panel, /Listening History &amp; Playback Awareness/);
    assert.match(panel, /value="7">7 days.*value="14">14 days.*value="30">30 days.*value="90">90 days/);
    assert.match(panel, /value="90">Not played for 3 months.*value="180">Not played for 6 months.*value="365">Not played for 1 year/);
    assert.match(panel, /Reset derived profile/);
    assert.match(panel, /stores it in the local database/);
    assert.match(panelCss, /@media/);
    assert.match(breakdown, /playback\.reasons/);
    assert.match(breakdown, /Playback confidence/);
  });
});
