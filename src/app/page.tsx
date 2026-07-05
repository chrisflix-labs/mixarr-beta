import styles from "./page.module.css";
import Link from "next/link";
import { BookMarked, BrainCircuit, Fingerprint, Gauge, HeartPulse, History, ListMusic, Map, Radio, Repeat2, ScrollText, SlidersHorizontal, Wand2 } from "lucide-react";
import LibrarySelector from "@/components/LibrarySelector";
import SyncProgress from "@/components/SyncProgress";
import PlexLoginButton from "@/components/PlexLoginButton";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { getCachedLibraryHealth } from "@/lib/libraryHealth";
import { APP_VERSION } from "@/lib/appVersion";
import { getRecentJobSummary } from "@/lib/jobHistory";

const previewFeatures = [
  {
    title: "Smart Mix Builder",
    description: "Build playlists from a vibe, mood, energy level, BPM range, genre blend, or listening goal.",
    examples: ["Late-night drive", "Gym mode", "Deep cuts only"],
    icon: SlidersHorizontal,
    badge: "Planned",
  },
  {
    title: "AI DJ Flow",
    description: "Create playlists with smooth pacing, energy curves, artist spacing, and better track-to-track flow.",
    examples: ["Warm-up to peak", "BPM-aware order", "Mood transitions"],
    icon: BrainCircuit,
    badge: "v2.0.0",
  },
  {
    title: "Infinite Radio Stations",
    description: "Generate living stations that keep refreshing based on your library, filters, and listening preferences.",
    examples: ["My Rock Radio", "Chill Night Station", "Discovery Radio"],
    icon: Radio,
    badge: "Concept",
  },
  {
    title: "Playlist Intelligence Score",
    description: "Preview playlist quality before saving with scoring for variety, flow, energy balance, and repeat risk.",
    examples: ["Flow score", "Genre spread", "Artist variety"],
    icon: Gauge,
    badge: "Preview",
  },
  {
    title: "Music DNA",
    description: "Visualize your library by energy, mood, BPM, genre, popularity, and audio feature coverage.",
    examples: ["Mood map", "BPM distribution", "Genre heatmap"],
    icon: Fingerprint,
    badge: "Planned",
  },
  {
    title: "Anti-Repeat Engine",
    description: "Prevent the same songs, artists, or albums from appearing too often.",
    examples: ["Track cooldown", "Artist cooldown", "Discovery boost"],
    icon: Repeat2,
    badge: "Concept",
  },
];

function MixarrVersionCard() {
  return (
    <article className={`${styles.card} ${styles.versionCard}`}>
      <ScrollText size={22} className={styles.cardIcon} />
      <h3>Mixarr Version</h3>
      <p>You are running Mixarr {APP_VERSION}.</p>
      <p>Check release notes and roadmap updates as Mixarr moves toward v2.0.0.</p>
      <div className={styles.versionCardActions}>
        <Link href="/release-notes" className={styles.cardAction}>Release Notes</Link>
        <Link href="/roadmap" className={`${styles.cardAction} ${styles.secondaryCardAction}`}>Roadmap</Link>
      </div>
    </article>
  );
}

function RecentJobsCard({ summary }: { summary: Awaited<ReturnType<typeof getRecentJobSummary>> | null }) {
  const lastJob = summary?.lastJob;
  return (
    <Link href="/jobs" className={`${styles.card} ${styles.recentJobsCard}`}>
      <History size={22} className={styles.cardIcon} />
      <h3>Recent Jobs</h3>
      <p>View recent syncs, retries, playlist runs, and analysis jobs.</p>
      {lastJob ? (
        <div className={styles.jobSummary}>
          <span>{lastJob.name}</span>
          <b data-status={lastJob.status}>{lastJob.status}</b>
          <small>{lastJob.finishedAt ? lastJob.finishedAt.toLocaleString() : "Still running"}</small>
        </div>
      ) : (
        <div className={styles.jobSummary}>
          <span>No jobs recorded yet</span>
          <small>Run a sync, retry, or playlist job.</small>
        </div>
      )}
      {summary && summary.recentFailures > 0 && (
        <p className={styles.failureText}>{summary.recentFailures} failure{summary.recentFailures === 1 ? "" : "s"} in the last 7 days</p>
      )}
      <span className={styles.cardAction}>View Job History</span>
    </Link>
  );
}

function PlaylistRecipesCard({ count }: { count: number }) {
  return (
    <article className={styles.card}>
      <BookMarked size={22} className={styles.cardIcon} />
      <h3>Playlist Recipes</h3>
      <p>Save and reuse your favorite playlist filter setups.</p>
      <div className={styles.recipeCardActions}>
        <span>{count.toLocaleString()} saved recipe{count === 1 ? "" : "s"}</span>
        <div>
          <Link href="/recipes" className={styles.cardAction}>View Recipes</Link>
          <Link href="/builder" className={`${styles.cardAction} ${styles.secondaryCardAction}`}>Build Playlist</Link>
        </div>
      </div>
    </article>
  );
}

export default async function Home() {
  const cookieStore = cookies();
  const sessionId = cookieStore.get("mixarr_session")?.value;

  let user = null;
  let health: Awaited<ReturnType<typeof getCachedLibraryHealth>> = [];
  let jobSummary: Awaited<ReturnType<typeof getRecentJobSummary>> | null = null;
  let recipeCount = 0;
  if (sessionId) {
    user = await prisma.user.findUnique({
      where: { id: sessionId },
    });
    if (user) {
      [health, jobSummary, recipeCount] = await Promise.all([
        getCachedLibraryHealth(user.id),
        getRecentJobSummary(user.id),
        prisma.playlistRecipe.count({ where: { userId: user.id, isArchived: false } }),
      ]);
    }
  }

  return (
    <>
      <header className={styles.header}>
        <h2>Dashboard</h2>
        <p>Library overview</p>
      </header>

      {user ? (
        <div style={{ marginBottom: "3rem" }}>
          <SyncProgress />
          {health.length > 0 ? (() => {
            const active = health.reduce((sum, library) => sum + library.activeTracks, 0);
            const missing = health.reduce((sum, library) => sum + library.missingTracks, 0);
            const bpmComplete = health.reduce((sum, library) => sum + library.tracksWithBpm, 0);
            const bpmApi = health.reduce((sum, library) => sum + (library as any).bpmApi, 0);
            const bpmLocal = health.reduce((sum, library) => sum + (library as any).bpmLocal, 0);
            const bpmImported = health.reduce((sum, library) => sum + (library as any).bpmImported, 0);
            const bpmMissing = health.reduce((sum, library) => sum + library.missingBpm, 0);
            const bpmFailed = health.reduce((sum, library) => sum + library.bpmFailed, 0);
            const audioComplete = health.reduce((sum, library) => sum + library.audioFeaturesComplete, 0);
            const audioApi = health.reduce((sum, library) => sum + library.audioFeaturesApi, 0);
            const audioLocal = health.reduce((sum, library) => sum + library.audioFeaturesLocal, 0);
            const audioEstimated = health.reduce((sum, library) => sum + library.audioFeaturesHeuristic, 0);
            const audioPartial = health.reduce((sum, library) => sum + library.audioFeaturesPartial, 0);
            const audioMissing = health.reduce((sum, library) => sum + library.audioFeaturesMissing, 0);
            const audioFailed = health.reduce((sum, library) => sum + library.audioFeaturesFailed, 0);
            const status = health.some((library) => library.status === "error") ? "Error" : health.some((library) => library.status === "warning") ? "Warning" : "Healthy";
            const latest = health.map((library) => library.lastFullSyncAt).filter(Boolean).sort().at(-1) || null;
            const healthUpdatedAt = health.map((library) => library.healthUpdatedAt).filter(Boolean).sort((left, right) => left.getTime() - right.getTime()).at(-1) || null;
            const bpmMode = (health[0] as any).bpmProviderMode || "API + Local, API preferred";
            const audioMode = (health[0] as any).audioFeatureProviderMode || "API + Local, API preferred";
            return <>
              <Link href="/library-health" className={`glass-panel ${styles.healthWidget}`}>
                <HeartPulse size={22} />
                <div><strong>Library Health</strong><span>Active: {active.toLocaleString()} &middot; Missing: {missing.toLocaleString()} &middot; Last sync: {latest ? new Date(latest).toLocaleString() : "Never"} &middot; Updated: {healthUpdatedAt ? healthUpdatedAt.toLocaleString() : "Snapshot"}</span></div>
                <b data-status={status.toLowerCase()}>{status}</b>
              </Link>
              <div className={styles.cardsGrid} style={{ marginBottom: "1.5rem" }}>
                <article className={styles.card}>
                  <h3>BPM / Tempo</h3>
                  <p>{bpmComplete.toLocaleString()} / {active.toLocaleString()}</p>
                  <p>API: {bpmApi.toLocaleString()} &middot; Local Essentia: {bpmLocal.toLocaleString()}</p>
                  <p>Imported: {bpmImported.toLocaleString()} &middot; Missing: {bpmMissing.toLocaleString()} &middot; Failed: {bpmFailed.toLocaleString()}</p>
                  <p>Mode: {bpmMode}</p>
                  <div className={styles.healthMetricLinks}>
                    <Link href="/library-health?filter=missing_bpm">Missing BPM</Link>
                    <Link href="/library-health?filter=api_bpm">API BPM Only</Link>
                    <Link href="/library-health?filter=failed_bpm_analysis">Failed</Link>
                  </div>
                </article>
                <article className={styles.card}>
                  <h3>Audio Features</h3>
                  <p>{audioComplete.toLocaleString()} / {active.toLocaleString()}</p>
                  <p>API: {audioApi.toLocaleString()} &middot; Local Essentia: {audioLocal.toLocaleString()}</p>
                  <p>Estimated: {audioEstimated.toLocaleString()} &middot; Partial: {audioPartial.toLocaleString()} &middot; Missing: {audioMissing.toLocaleString()} &middot; Failed: {audioFailed.toLocaleString()}</p>
                  <p>Mode: {audioMode}</p>
                  <div className={styles.healthMetricLinks}>
                    <Link href="/library-health?filter=missing_audio_features">Missing Features</Link>
                    <Link href="/library-health?filter=partial_audio_features">Partial Features</Link>
                    <Link href="/library-health?filter=failed_audio_feature_analysis">Failed</Link>
                  </div>
                </article>
              </div>
            </>;
          })() : (
            <Link href="/library-health" className={`glass-panel ${styles.healthWidget}`}>
              <HeartPulse size={22} />
              <div>
                <strong>Library Health</strong>
                <span>Library Health is refreshing. Open Library Health for current details.</span>
              </div>
              <b data-status="warning">Refreshing</b>
            </Link>
          )}
          <div className={styles.compactCardsGrid}>
            <RecentJobsCard summary={jobSummary} />
            <PlaylistRecipesCard count={recipeCount} />
            <MixarrVersionCard />
            <Link href="/roadmap" className={`${styles.card} ${styles.roadmapCard}`}>
              <Map size={22} className={styles.cardIcon} />
              <h3>Roadmap to v2.0.0</h3>
              <p>Follow Mixarr&apos;s path toward the Smart Mix Engine, saved playlist recipes, better library health tools, and experimental beta features.</p>
              <span className={styles.cardAction}>View Roadmap</span>
            </Link>
          </div>
          <section className={styles.comingSoonSection} aria-labelledby="coming-soon-v2">
            <div className={styles.comingSoonHeader}>
              <div>
                <span className={styles.kicker}>Preview</span>
                <h3 id="coming-soon-v2">Coming Soon in v2.0.0</h3>
                <p>Next-level playlist intelligence is coming to Mixarr.</p>
              </div>
              <span className={styles.versionPill}>v2.0.0</span>
            </div>
            <p className={styles.enrichmentNote}>
              Data enrichment controls have moved into their matching dashboard cards. Use the play button on each card to run or retry BPM, genres, popularity, or audio feature processing.
            </p>
            <div className={styles.previewGrid}>
              {previewFeatures.map((feature) => {
                const Icon = feature.icon;
                return (
                  <article key={feature.title} className={styles.previewCard}>
                    <div className={styles.previewCardTop}>
                      <span className={styles.previewIcon}><Icon size={18} /></span>
                      <span className={styles.previewBadge}>{feature.badge}</span>
                    </div>
                    <h4>{feature.title}</h4>
                    <p>{feature.description}</p>
                    <div className={styles.previewExamples}>
                      {feature.examples.map((example) => (
                        <span key={example}>{example}</span>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
          <div className={styles.sectionHeader}>
            <h3>Your Plex Servers</h3>
          </div>
          <LibrarySelector />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2rem", marginBottom: "3rem" }}>
          <div className="glass-panel" style={{ padding: "2rem", textAlign: "center", borderRadius: "var(--radius-lg)", width: "100%", maxWidth: "600px" }}>
            <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.5rem" }}>Mixarr</h3>
            <p style={{ color: "var(--text-secondary)", marginBottom: "2rem" }}>
              Sign in with Plex to import your library and start building curated playlists.
            </p>
            {/* @ts-ignore - The component is client-side but we render it here */}
            <div style={{ display: "flex", justifyContent: "center" }}>
              <PlexLoginButton />
            </div>
          </div>

          <div className={styles.cardsGrid} style={{ width: "100%" }}>
            <div className={styles.card}>
              <Wand2 size={24} className={styles.cardIcon} />
              <h3>Build Playlist</h3>
              <p>Create a playlist with rules</p>
            </div>

            <div className={styles.card}>
              <ListMusic size={24} className={styles.cardIcon} />
              <h3>Browse Library</h3>
              <p>Explore your collection</p>
            </div>

            <div className={styles.card}>
              <ListMusic size={24} className={styles.cardIcon} />
              <h3>My Playlists</h3>
              <p>0 playlists created</p>
            </div>

            <MixarrVersionCard />

            <RecentJobsCard summary={null} />

            <PlaylistRecipesCard count={0} />

            <Link href="/roadmap" className={`${styles.card} ${styles.roadmapCard}`}>
              <Map size={24} className={styles.cardIcon} />
              <h3>Roadmap to v2.0.0</h3>
              <p>Follow Mixarr&apos;s path toward the Smart Mix Engine, saved playlist recipes, better library health tools, and experimental beta features.</p>
              <span className={styles.cardAction}>View Roadmap</span>
            </Link>
          </div>
        </div>
      )}

      <div className={styles.recentSection}>
        <div className={styles.sectionHeader}>
          <h3>Recent Playlists</h3>
          <a href="#" className={styles.viewAll}>View All &rarr;</a>
        </div>
        <div className={styles.recentGrid}>
          <div className={styles.recentCard}>
            <div className={styles.recentIcon}>
              <ListMusic size={20} />
            </div>
            <div>
              <h4>Create your first mix</h4>
              <p>Open the builder to get started</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
