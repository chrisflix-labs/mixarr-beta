import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "fs/promises";
import path from "path";
import { bpmFailedTrackWhere, pendingBpmBackfillTrackWhere } from "./bpm";
import {
  audioFeatureHealthFilterWhere,
  bpmHealthFilterWhere,
  buildAudioFeatureTrackWhere,
  buildBpmRetryBaseWhere,
  buildBpmRetryCandidateWhere,
  buildBpmTrackWhere,
  buildMetadataTrackWhere,
  buildMissingTrackWhere,
  determineLibraryHealthStatus,
  metadataTrackStatus,
  missingPopularityWhere,
  missingTrackBpmStatus,
  pendingGenreBackfillWhere,
  popularityNoDataWhere,
  toCsv,
  tracksWithPopularityWhere,
} from "./libraryHealth";
import { buildLibraryHealthTrackWhere } from "./libraryHealthDetails";

describe("library health", () => {
  const now = new Date("2026-06-22T12:00:00Z");

  it("is healthy only after a complete, matching, recent sync", () => {
    assert.equal(determineLibraryHealthStatus({
      lastSyncStatus: "success",
      snapshotComplete: true,
      plexReportedTrackCount: 33_137,
      activeTrackCount: 33_137,
      missingTrackCount: 0,
      bpmFailureCount: 0,
      lastSyncAt: "2026-06-22T11:00:00Z",
      now,
    }), "healthy");
  });

  it("warns for missing records or BPM failures without hiding sync integrity", () => {
    assert.equal(determineLibraryHealthStatus({
      lastSyncStatus: "success",
      snapshotComplete: true,
      plexReportedTrackCount: 33_137,
      activeTrackCount: 33_137,
      missingTrackCount: 41,
      bpmFailureCount: 0,
      lastSyncAt: "2026-06-22T11:00:00Z",
      now,
    }), "warning");
  });

  it("reports failed, partial, interrupted, and mismatched syncs as errors", () => {
    const base = { activeTrackCount: 10, missingTrackCount: 0, bpmFailureCount: 0, lastSyncAt: now, now };
    assert.equal(determineLibraryHealthStatus({ ...base, lastSyncStatus: "failed" }), "error");
    assert.equal(determineLibraryHealthStatus({ ...base, lastSyncStatus: "success", snapshotComplete: false }), "error");
    assert.equal(determineLibraryHealthStatus({ ...base, lastSyncStatus: "success", snapshotComplete: true, plexReportedTrackCount: 11 }), "error");
    assert.equal(determineLibraryHealthStatus({ ...base, lastSyncStatus: "in_progress", lastSyncAt: "2026-06-20T00:00:00Z" }), "error");
    assert.equal(determineLibraryHealthStatus({ ...base, lastSyncStatus: "in_progress", plexReportedTrackCount: 11 }), "warning");
  });

  it("always scopes missing queries to the signed-in user's missing tracks", () => {
    const where = buildMissingTrackWhere("user-a", { libraryId: "library-a", search: "song" }) as any;
    assert.equal(where.AND[0].syncStatus, "missing");
    assert.equal(where.AND[0].library.id, "library-a");
    assert.equal(where.AND[0].library.server.userId, "user-a");
  });

  it("always scopes BPM health queries to the signed-in user's active tracks", () => {
    const where = buildBpmTrackWhere("user-a", { filter: "missing_bpm", libraryId: "library-a", search: "song" }) as any;
    assert.equal(where.AND[0].syncStatus, "active");
    assert.equal(where.AND[0].library.id, "library-a");
    assert.equal(where.AND[0].library.server.userId, "user-a");
    assert.match(JSON.stringify(where.AND[2]), /artist/);
    assert.match(JSON.stringify(where.AND[2]), /album/);
    assert.match(JSON.stringify(where.AND[2]), /mediaPath/);
  });

  it("always scopes metadata health queries to active tracks and searchable metadata fields", () => {
    const where = buildMetadataTrackWhere("user-a", { section: "genres", filter: "missing_genres", libraryId: "library-a", search: "rating-42" }) as any;
    assert.equal(where.AND[0].syncStatus, "active");
    assert.equal(where.AND[0].library.id, "library-a");
    assert.equal(where.AND[0].library.server.userId, "user-a");
    assert.match(JSON.stringify(where.AND[2]), /artist/);
    assert.match(JSON.stringify(where.AND[2]), /album/);
    assert.match(JSON.stringify(where.AND[2]), /mediaPath/);
    assert.match(JSON.stringify(where.AND[2]), /ratingKey/);
  });

  it("uses matching audio-feature predicates for summary filters and detail track queries", () => {
    const settings = { api: false, local: true, preferLocalAudioFeatures: true };
    const detailWhere = buildAudioFeatureTrackWhere("user-a", {
      filter: "missing_audio_features",
      libraryId: "library-a",
      settings,
    }) as any;

    assert.deepEqual(detailWhere.AND[1], audioFeatureHealthFilterWhere("missing_audio_features", settings));
    assert.deepEqual(
      (buildAudioFeatureTrackWhere("user-a", { filter: "partial_audio_features", libraryId: "library-a", settings }) as any).AND[1],
      audioFeatureHealthFilterWhere("partial_audio_features", settings),
    );
    assert.deepEqual(
      (buildAudioFeatureTrackWhere("user-a", { filter: "pending_audio_features", libraryId: "library-a", settings }) as any).AND[1],
      audioFeatureHealthFilterWhere("pending_audio_features", settings),
    );
    assert.match(JSON.stringify(audioFeatureHealthFilterWhere("pending_audio_features", settings)), /too_short/);
  });

  it("uses the same missing audio-feature predicate for detail counts and click-through tracks", () => {
    const settings = { api: false, local: true, preferLocalAudioFeatures: true };
    const where = buildLibraryHealthTrackWhere("user-a", {
      category: "missing_audio_features",
      libraryId: "library-a",
      settings,
    }) as any;

    assert.equal(where.AND[0].syncStatus, "active");
    assert.equal(where.AND[0].library.id, "library-a");
    assert.deepEqual(where.AND[1], audioFeatureHealthFilterWhere("missing_audio_features", settings));
    assert.match(JSON.stringify(where), /"is":null/);
  });

  it("merges detected audio feature gaps before returning summary counts", async () => {
    const source = await readFile(path.join(process.cwd(), "src/lib/libraryHealth.ts"), "utf8");
    const details = await readFile(path.join(process.cwd(), "src/lib/libraryHealthDetails.ts"), "utf8");
    const classifier = await readFile(path.join(process.cwd(), "src/lib/audioFeatureHealthClassification.ts"), "utf8");

    assert.match(source, /getAudioFeatureHealthClassification/);
    assert.match(classifier, /mergeAudioFeatureHealthGapCounts/);
    assert.match(classifier, /missing: merged\.missing/);
    assert.match(classifier, /pending: merged\.pending/);
    assert.match(details, /categories\.missing_audio_features = missingAudioFeatureTracks\.count/);
    assert.match(details, /categories\.pending_audio_features = pendingAudioFeatureTracks\.count/);
  });

  it("uses shared Library Health track ID resolution for card counts and detail rows", async () => {
    const details = await readFile(path.join(process.cwd(), "src/lib/libraryHealthDetails.ts"), "utf8");
    const detailRoute = await readFile(path.join(process.cwd(), "src/app/api/library-health/tracks/route.ts"), "utf8");

    assert.match(details, /resolveLibraryHealthTrackIds/);
    assert.match(details, /categories\.missing_audio_features = missingAudioFeatureTracks\.count/);
    assert.match(details, /categories\.pending_audio_features = pendingAudioFeatureTracks\.count/);
    assert.match(detailRoute, /resolveLibraryHealthTrackIds/);
    assert.match(detailRoute, /resolvedTrackIds: resolved\?\.trackIds/);
    assert.match(detailRoute, /Count\/detail mismatch/);
  });

  it("resolves audio feature gap IDs into missing and pending detail/retry sets", async () => {
    const details = await readFile(path.join(process.cwd(), "src/lib/libraryHealthDetails.ts"), "utf8");
    const retryRoute = await readFile(path.join(process.cwd(), "src/app/api/library-health/retry/route.ts"), "utf8");

    assert.match(details, /normalTrackIds/);
    assert.match(details, /audioFeatureClassification\.gapTrackIds/);
    assert.match(details, /reasonByTrackId/);
    assert.match(details, /No audio feature record found/);
    assert.match(retryRoute, /resolveLibraryHealthTrackIds/);
    assert.match(retryRoute, /retry filter=\$\{filter\} matched=\$\{matched\}/);
  });

  it("settings audio-feature retry uses the selected health filter before eligibility skips", async () => {
    const retryRoute = await readFile(path.join(process.cwd(), "src/app/api/settings/library-health/audio-feature-retry/route.ts"), "utf8");

    assert.match(retryRoute, /buildAudioFeatureHealthQuery/);
    assert.match(retryRoute, /gapTrackIds/);
    assert.match(retryRoute, /settings: syncSettings/);
    assert.match(retryRoute, /matched: originalCount/);
    assert.match(retryRoute, /queued: ids\.length/);
    assert.match(retryRoute, /audioFeature\.createMany/);
    assert.match(retryRoute, /skipDuplicates: true/);
  });

  it("Library Health details expose the audio feature gap diagnostic and avoid a hidden empty state", async () => {
    const page = await readFile(path.join(process.cwd(), "src/app/library-health/page.tsx"), "utf8");
    const summaryRoute = await readFile(path.join(process.cwd(), "src/app/api/library-health/summary/route.ts"), "utf8");

    assert.match(summaryRoute, /getLibraryHealthDetailSummary/);
    assert.match(page, /Audio feature gap detected/);
    assert.match(page, /classified as missing audio features/);
    assert.match(page, /pagination\.total/);
  });

  it("dashboard audio-feature progress shows incomplete counts without rounded 100 percent hiding gaps", async () => {
    const dashboard = await readFile(path.join(process.cwd(), "src/app/page.tsx"), "utf8");
    const syncProgress = await readFile(path.join(process.cwd(), "src/components/SyncProgress.tsx"), "utf8");

    assert.match(dashboard, /audioPercent\.toFixed\(1\)/);
    assert.match(dashboard, /incomplete/);
    assert.doesNotMatch(dashboard, /pending or incomplete/);
    assert.match(syncProgress, /formatProgressPercent/);
    assert.match(syncProgress, /incomplete/);
  });

  it("does not count placeholder popularity rows as completed metadata", () => {
    const valid = JSON.stringify(tracksWithPopularityWhere());
    assert.match(valid, /deezer/);
    assert.match(valid, /spotify/);
    assert.doesNotMatch(valid, /not_found/);

    const missing = JSON.stringify(missingPopularityWhere());
    assert.match(missing, /notIn/);

    const noData = JSON.stringify(popularityNoDataWhere());
    assert.match(noData, /not_found/);
  });

  it("keeps pending genre backfill separate from terminal no-data and failed states", () => {
    const pending = JSON.stringify(pendingGenreBackfillWhere());
    assert.match(pending, /pending/);
    assert.match(pending, /tagsSyncedAt/);
    assert.doesNotMatch(pending, /no_data/);
  });

  it("treats BPM failed as the umbrella for every terminal failure", () => {
    const failed = JSON.stringify(bpmFailedTrackWhere());
    assert.match(failed, /\"failed\"/);
    assert.match(failed, /extraction_failed/);
    assert.match(failed, /analyzer_failed/);
    assert.doesNotMatch(failed, /too_short/);

    const pending = JSON.stringify(pendingBpmBackfillTrackWhere());
    assert.match(pending, /notIn/);
    assert.match(pending, /no_data/);
    assert.match(pending, /too_short/);
  });

  it("escapes spreadsheet formulas and quotes in CSV exports", () => {
    const csv = toCsv([{
      library: { name: "Music" }, title: "=cmd", artist: { title: 'A "Band"' }, album: { title: "Album" },
      ratingKey: "42", mediaPath: "/music/song.flac", lastSeenAt: null, missingSince: null,
      lastSeenSyncId: "sync-1", bpmAnalysisStatus: "no_data", audioFeature: null,
    }]);
    assert.match(csv, /"'=cmd"/);
    assert.match(csv, /"A ""Band"""/);
  });

  it("exposes analyzer failures separately from extraction failures", () => {
    assert.equal(missingTrackBpmStatus({ bpm: null, bpmAnalysisStatus: "analyzer_failed" }), "analyzer_failed");
    assert.equal(missingTrackBpmStatus({ bpm: null, bpmAnalysisStatus: "extraction_failed" }), "extraction_failed");
    assert.equal(missingTrackBpmStatus({ bpm: null, bpmAnalysisStatus: "too_short" }), "too_short");
  });

  it("serializes legacy metadata attempt markers into health statuses", () => {
    assert.equal(metadataTrackStatus("genres", { tags: [], genreStatus: null, tagsSyncedAt: new Date() }), "no_data");
    assert.equal(metadataTrackStatus("popularity", { popularityStatus: null, popularity: { provider: "not_found" } }), "no_data");
    assert.equal(metadataTrackStatus("popularity", { popularityStatus: null, popularity: { provider: "spotify", score: 0 } }), "success");
  });

  it("revalidates Library Health after audio-feature retry queueing and completion", async () => {
    const retryRoute = await readFile(path.join(process.cwd(), "src/app/api/settings/library-health/audio-feature-retry/route.ts"), "utf8");
    const syncStartRoute = await readFile(path.join(process.cwd(), "src/app/api/sync/start/route.ts"), "utf8");

    assert.match(retryRoute, /revalidatePath\("\/settings\/library-health"\)/);
    assert.doesNotMatch(retryRoute, /audioFeatureAnalyzedAt:\s*null/);
    assert.match(syncStartRoute, /logPartialAudioFeatureRetryResult/);
    assert.match(syncStartRoute, /preferLocalAudioFeatures:\s*true/);
    assert.match(syncStartRoute, /revalidatePath\("\/settings\/library-health"\)/);
  });

  it("starts BPM retry jobs with the selected filter and provider mode", async () => {
    const page = await readFile(path.join(process.cwd(), "src/app/settings/library-health/page.tsx"), "utf8");
    const syncStartRoute = await readFile(path.join(process.cwd(), "src/app/api/sync/start/route.ts"), "utf8");

    assert.match(page, /providerMode: "local_only"/);
    assert.match(page, /filter: payload\.filter/);
    assert.match(page, /force: providerMode === "force_local"/);
    assert.match(syncStartRoute, /bpmBackfillFilter/);
    assert.match(syncStartRoute, /preferLocalBpm: true/);
    assert.match(syncStartRoute, /reprocessApiBpmWithLocal: true/);
  });

  it("uses the same API BPM predicate for health counts and local retry candidates", () => {
    const healthWhere = buildBpmRetryBaseWhere("user-a", {
      filter: "api_bpm",
      libraryId: "library-a",
    });
    const retryWhere = buildBpmRetryCandidateWhere("user-a", {
      filter: "api_bpm",
      libraryId: "library-a",
      providerMode: "local_only",
    });

    assert.deepEqual(retryWhere, { AND: [healthWhere, {}] });
    assert.deepEqual((healthWhere as any).AND[1], bpmHealthFilterWhere("api_bpm"));
  });

  it("logs BPM retry health and candidate counts for mismatch diagnosis", async () => {
    const retryRoute = await readFile(path.join(process.cwd(), "src/app/api/settings/library-health/bpm-retry/route.ts"), "utf8");

    assert.match(retryRoute, /BPM retry requested filter=/);
    assert.match(retryRoute, /BPM health count for/);
    assert.match(retryRoute, /BPM retry candidates for/);
    assert.match(retryRoute, /WARNING: BPM filter mismatch/);
    assert.match(retryRoute, /sampleTrackIds/);
  });

  it("does not block homepage SSR on fresh Library Health calculation", async () => {
    const page = await readFile(path.join(process.cwd(), "src/app/page.tsx"), "utf8");

    assert.match(page, /getCachedLibraryHealth/);
    assert.doesNotMatch(page, /getLibraryHealth\(user\.id\)/);
    assert.match(page, /Library Health is refreshing/);
  });

  it("uses grouped health summary queries instead of unbounded per-library count batches", async () => {
    const source = await readFile(path.join(process.cwd(), "src/lib/libraryHealth.ts"), "utf8");

    assert.doesNotMatch(source, /Promise\.all\(libraries\.map/);
    assert.match(source, /for \(const library of libraries\)/);
    assert.match(source, /COUNT\(\*\) FILTER/);
    assert.match(source, /EXISTS \(/);
    assert.match(source, /saveLibraryHealthSnapshot/);
  });
});
