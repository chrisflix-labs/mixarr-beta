#!/usr/bin/env node

// Runs the compiled production sync engine against an on-demand synthetic Plex
// server. Build the test distribution first (`npx tsc -p tsconfig.tests.json`).
// This avoids creating 150,000 audio files while retaining the real HTTP,
// normalization, reconciliation, Prisma, and PostgreSQL code paths.

const http = require("node:http");
const { performance } = require("node:perf_hooks");
const os = require("node:os");
const path = require("node:path");

process.env.MIXARR_CONFIG_DIR ||= path.join(os.tmpdir(), "mixarr-storage-benchmark", "config");
process.env.MIXARR_DATA_DIR ||= path.join(os.tmpdir(), "mixarr-storage-benchmark", "data");
process.env.MIXARR_SCAN_PROGRESS_INTERVAL ||= "25000";

function argument(name, fallback) {
  const exact = process.argv.find((value) => value.startsWith(`${name}=`));
  const index = process.argv.indexOf(name);
  return exact ? exact.slice(name.length + 1) : index >= 0 ? process.argv[index + 1] : fallback;
}
const TRACKS = Math.max(1, Number(argument("--tracks", process.argv[2] || "150000")));
const RUNS = Math.max(1, Number(argument("--runs", process.argv[3] || "1")));
const SUITE = process.argv.includes("--suite");
const ALBUM_SIZE = 10;
const ARTIST_SIZE = 1000;
const plexState = { visibleTracks: Math.max(1, Number(argument("--visible", TRACKS))), modifiedTracks: Math.max(0, Number(argument("--modified", 0))), failAtTrackOffset: null };

function page(start, size, total, factory) {
  const length = Math.max(0, Math.min(size, total - start));
  return Array.from({ length }, (_, offset) => factory(start + offset));
}

function syntheticItem(type, index) {
  if (type === 8) {
    return {
      ratingKey: `artist-${index}`,
      title: `Synthetic Artist ${index}`,
      addedAt: 1_700_000_000,
      updatedAt: 1_700_000_000,
      Genre: [{ tag: `Genre ${index % 20}` }],
    };
  }
  if (type === 9) {
    return {
      ratingKey: `album-${index}`,
      parentRatingKey: `artist-${Math.floor(index / (ARTIST_SIZE / ALBUM_SIZE))}`,
      title: `Synthetic Album ${index}`,
      leafCount: ALBUM_SIZE,
      year: 2000 + (index % 25),
      addedAt: 1_700_000_000,
      updatedAt: 1_700_000_000,
    };
  }
  const albumIndex = Math.floor(index / ALBUM_SIZE);
  const artistIndex = Math.floor(index / ARTIST_SIZE);
  return {
    ratingKey: `track-${index}`,
    key: `/library/metadata/track-${index}`,
    guid: `local://synthetic/${index}`,
    title: `Synthetic Track ${index}${index < plexState.modifiedTracks ? " (modified)" : ""}`,
    grandparentRatingKey: `artist-${artistIndex}`,
    grandparentTitle: `Synthetic Artist ${artistIndex}`,
    parentRatingKey: `album-${albumIndex}`,
    parentTitle: `Synthetic Album ${albumIndex}`,
    duration: 180_000 + (index % 120_000),
    index: (index % ALBUM_SIZE) + 1,
    rating: 5,
    viewCount: index % 100,
    addedAt: 1_700_000_000,
    updatedAt: 1_700_000_000 + (index < plexState.modifiedTracks ? 3600 : 0),
    Media: [{ Part: [{ id: `part-${index}`, file: `/synthetic/music/${artistIndex}/${albumIndex}/${index}.flac`, size: 5_000_000, container: "flac" }] }],
  };
}

function syntheticPlexServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/library/sections") {
      const payload = JSON.stringify({ MediaContainer: { Directory: [{ key: "1", title: "Synthetic 150k", type: "artist", refreshing: false }] } });
      response.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }); response.end(payload); return;
    }
    const type = Number(url.searchParams.get("type"));
    const start = Number(url.searchParams.get("X-Plex-Container-Start") || "0");
    const size = Number(url.searchParams.get("X-Plex-Container-Size") || "500");
    if (type === 10 && plexState.failAtTrackOffset !== null && start >= plexState.failAtTrackOffset) {
      plexState.failAtTrackOffset = null;
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "synthetic interrupted scan" }));
      return;
    }
    const total = type === 8
      ? Math.ceil(TRACKS / ARTIST_SIZE)
      : type === 9
        ? Math.ceil(TRACKS / ALBUM_SIZE)
        : plexState.visibleTracks;
    const items = page(start, size, total, (index) => syntheticItem(type, index));
    const payload = JSON.stringify({ MediaContainer: { size: items.length, totalSize: total, Metadata: items } });
    response.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
    response.end(payload);
  });
}

async function databaseMeasurement(prisma) {
  const [database] = await prisma.$queryRawUnsafe(
    "SELECT pg_database_size(current_database())::bigint AS bytes, pg_current_wal_lsn()::text AS lsn",
  );
  const tables = await prisma.$queryRawUnsafe(
    `SELECT relname, n_live_tup::bigint AS live, n_dead_tup::bigint AS dead,
            n_tup_ins::bigint AS inserted, n_tup_upd::bigint AS updated,
            pg_total_relation_size(relid)::bigint AS bytes
       FROM pg_stat_user_tables
      WHERE relname IN ('Track','Artist','Album','SyncLog','JobHistory')
      ORDER BY relname`,
  );
  return { databaseBytes: Number(database.bytes), lsn: database.lsn, tables };
}

async function walBytes(prisma, beforeLsn, afterLsn) {
  const [row] = await prisma.$queryRawUnsafe(
    "SELECT pg_wal_lsn_diff($1::pg_lsn, $2::pg_lsn)::bigint AS bytes",
    afterLsn,
    beforeLsn,
  );
  return Number(row.bytes);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const prisma = require("../.test-dist/src/lib/prisma.js").default;
  const server = syntheticPlexServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  try {
    const reuse = process.argv.includes("--reuse");
    let user; let library;
    if (reuse) {
      user = await prisma.user.findFirstOrThrow({ where: { username: "storage-benchmark" } });
      library = await prisma.library.findFirstOrThrow({ where: { server: { userId: user.id } }, include: { server: true } });
      await prisma.server.update({ where: { id: library.serverId }, data: { uri: `http://127.0.0.1:${port}` } });
    } else {
      await prisma.user.deleteMany({ where: { username: "storage-benchmark" } });
      user = await prisma.user.create({ data: { plexId: 2_147_000_000, username: "storage-benchmark", accessToken: "synthetic", isAdmin: true } });
      const mediaServer = await prisma.server.create({ data: { machineIdentifier: `synthetic-${Date.now()}`, name: "Synthetic Plex", uri: `http://127.0.0.1:${port}`, accessToken: "synthetic", userId: user.id } });
      library = await prisma.library.create({ data: { plexId: "1", serverId: mediaServer.id, name: "Synthetic 150k", type: "artist" } });
    }

    // Load only after DATABASE_URL and the synthetic server are ready.
    const { runSyncEngine } = require("../.test-dist/src/lib/syncEngine.js");
    const { fileStorageDiagnostics, resolveStoragePaths } = require("../.test-dist/src/lib/storage.js");
    const results = [];
    const execute = async (label, expectFailure = false) => {
      const before = await databaseMeasurement(prisma);
      const filesBefore = await fileStorageDiagnostics(resolveStoragePaths());
      let peakRss = process.memoryUsage().rss;
      const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 25);
      const started = performance.now();
      const summary = await runSyncEngine(library.id, { plexPageSize: 500 });
      clearInterval(sampler);
      if (!summary && !expectFailure) throw new Error(`Synthetic scan ${label} failed; inspect the sync error above.`);
      if (summary && expectFailure) throw new Error(`Synthetic scan ${label} unexpectedly succeeded.`);
      const after = await databaseMeasurement(prisma);
      const filesAfter = await fileStorageDiagnostics(resolveStoragePaths());
      const tableBefore = new Map(before.tables.map((row) => [row.relname, row]));
      const tableDeltas = Object.fromEntries(after.tables.map((row) => [row.relname, {
        inserted: Number(row.inserted) - Number(tableBefore.get(row.relname)?.inserted || 0),
        updated: Number(row.updated) - Number(tableBefore.get(row.relname)?.updated || 0),
        dead: Number(row.dead),
        bytesGrowth: Number(row.bytes) - Number(tableBefore.get(row.relname)?.bytes || 0),
      }]));
      results.push({
        label,
        durationMs: Math.round(performance.now() - started),
        peakRssBytes: peakRss,
        databaseGrowthBytes: after.databaseBytes - before.databaseBytes,
        walGrowthBytes: await walBytes(prisma, before.lsn, after.lsn),
        counts: summary && { inserted: summary.newTracks, updatedMetadata: summary.updatedMetadata, renamed: summary.renamedTracks, moved: summary.movedFiles, missing: summary.markedMissing, restored: summary.restored, skipped: summary.skipped, processed: summary.processed },
        records: { tracks: await prisma.track.count({ where: { libraryId: library.id } }), staging: await prisma.plexScanSeenTrack.count(), scanHistory: await prisma.syncLog.count({ where: { libraryId: library.id } }), jobHistory: await prisma.jobHistory.count({ where: { userId: user.id } }) },
        managedFileGrowthBytes: Object.fromEntries(["cacheBytes", "artworkBytes", "temporaryBytes", "backupBytes", "exportBytes", "logBytes"].map((key) => [key, filesAfter[key] - filesBefore[key]])),
        tableDeltas,
      });
      return summary;
    };
    if (SUITE) {
      await execute("initial");
      await execute("unchanged-1");
      plexState.modifiedTracks = Math.ceil(TRACKS * 0.01); await execute("modified-1-percent");
      plexState.visibleTracks = TRACKS - Math.ceil(TRACKS * 0.01); await execute("missing-1-percent");
      for (let run = 1; run <= 5; run += 1) await execute(`unchanged-after-missing-${run}`);
      plexState.failAtTrackOffset = Math.min(1000, Math.max(500, plexState.visibleTracks - 500)); await execute("interrupted", true);
      await prisma.$disconnect();
      await execute("restart-recovery");
    } else {
      for (let run = 1; run <= RUNS; run += 1) await execute(`run-${run}`);
    }
    console.log(JSON.stringify({ tracks: TRACKS, batchSize: 500, suite: SUITE, runs: results }, (_, value) => typeof value === "bigint" ? Number(value) : value, 2));
  } finally {
    await prisma.$disconnect();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
