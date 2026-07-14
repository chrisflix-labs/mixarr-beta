import styles from "./page.module.css";
import Link from "next/link";
import { AudioWaveform, BookMarked, BrainCircuit, Fingerprint, FlaskConical, Gauge, History, LifeBuoy, ListMusic, ListRestart, Map, Radio, Repeat2, ScrollText, ShieldAlert, SlidersHorizontal, Sparkles, Wand2 } from "lucide-react";
import LibrarySelector from "@/components/LibrarySelector";
import SyncProgress from "@/components/SyncProgress";
import WorkerHealthCard from "@/components/WorkerHealthCard";
import PlexLoginButton from "@/components/PlexLoginButton";
import DashboardSummaryCards from "@/components/DashboardSummaryCards";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { APP_VERSION } from "@/lib/appVersion";
import { getRecentJobSummary } from "@/lib/jobHistory";
import { getPlaylistHistoryDashboardSummary } from "@/lib/playlistHistory";
import { getDashboardSummary, type DashboardSummary } from "@/lib/dashboardSummary";
import { isFeatureEnabled as isResolvedBetaFeatureEnabled } from "@/lib/featureFlagService";
import RecentlyAddedDiscoveryCard from "@/components/RecentlyAddedDiscoveryCard";

const previewFeatures = [
  {
    title: "Smart Playlist Builder",
    description: "Start with guided presets, tune mood and BPM, then export, import, and review recipe-backed playlists.",
    examples: ["Workout", "Mood Presets", "Recipe Import"],
    icon: SlidersHorizontal,
    badge: "v1.2.9.1",
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
        <Link href="/support" className={`${styles.cardAction} ${styles.secondaryCardAction}`}><LifeBuoy size={14} /> Beta Support</Link>
      </div>
    </article>
  );
}

function RecentJobsCard({ summary }: { summary: Awaited<ReturnType<typeof getRecentJobSummary>> | null }) {
  const lastJob = summary?.lastJob;
  return (
    <Link href="/job-history" className={`${styles.card} ${styles.recentJobsCard}`}>
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

function GuestDataEnrichmentDashboardCard() {
  return (
    <Link href="/data-enrichment" className={styles.card}>
      <AudioWaveform size={22} className={styles.cardIcon} />
      <h3>Data Enrichment</h3>
      <p>Sign in with Plex to load BPM, audio features, genres, and popularity metadata summaries.</p>
      <span className={styles.cardAction}>Manage Enrichment</span>
    </Link>
  );
}

function PlaylistRecipesCard({ count }: { count: number }) {
  return (
    <article className={styles.card}>
      <BookMarked size={22} className={styles.cardIcon} />
      <h3>Playlist Recipes</h3>
      <p>Save, reuse, export, and import playlist recipes.</p>
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

function PlaylistRegenerationCard({ count }: { count: number }) {
  return (
    <article className={styles.card}>
      <ListRestart size={22} className={styles.cardIcon} />
      <h3>Playlist Regeneration</h3>
      <p>Refresh existing Mixarr playlists using saved filters, recipes, presets, and safety rules.</p>
      <div className={styles.recipeCardActions}>
        <span>{count.toLocaleString()} generated playlist{count === 1 ? "" : "s"} tracked</span>
        <div>
          <Link href="/generated-playlists" className={styles.cardAction}>View Generated Playlists</Link>
        </div>
      </div>
    </article>
  );
}

function PlaylistHistoryCard({
  count,
  lastEvent,
}: {
  count: number;
  lastEvent?: { playlistName: string; eventType: string; createdAt: Date } | null;
}) {
  const eventLabel = lastEvent?.eventType === "regenerated"
    ? "Regenerated"
    : lastEvent?.eventType === "removed_tracking"
    ? "Removed Tracking"
    : lastEvent?.eventType === "created_copy"
    ? "Created Copy"
    : lastEvent
    ? "Created"
    : "No events yet";

  return (
    <article className={styles.card}>
      <History size={22} className={styles.cardIcon} />
      <h3>Playlist History</h3>
      <p>Review recently created and regenerated playlists, including filters, presets, and track snapshots.</p>
      <div className={styles.recipeCardActions}>
        <span>{count.toLocaleString()} playlist histor{count === 1 ? "y entry" : "y entries"}</span>
        {lastEvent && (
          <small className={styles.cardDetailLine}>
            Last: {eventLabel} {lastEvent.playlistName} on {lastEvent.createdAt.toLocaleString()}
          </small>
        )}
        <div>
          <Link href="/playlist-history" className={styles.cardAction}>View Playlist History</Link>
        </div>
      </div>
    </article>
  );
}

function SmartBuilderCard() {
  return (
    <article className={styles.card}>
      <Sparkles size={22} className={styles.cardIcon} />
      <h3>Smart Playlist Builder</h3>
      <p>Choose a goal like Workout, Chill, Party, Focus, or Discovery, then tune the vibe with Mood and BPM Presets.</p>
      <div className={styles.versionCardActions}>
        <Link href="/smart-builder" className={styles.cardAction}>Open Smart Builder</Link>
        <Link href="/recipes" className={`${styles.cardAction} ${styles.secondaryCardAction}`}>View Recipes</Link>
      </div>
    </article>
  );
}

function BetaDashboardPreviewCards() {
  return (
    <>
      <article className={`${styles.card} ${styles.betaOnlyCard}`}>
        <div className={styles.betaCardTop}>
          <FlaskConical size={22} className={styles.cardIcon} />
          <span className={styles.betaBadge}>Experimental</span>
        </div>
        <h3>Experimental Playlist Intelligence</h3>
        <p>This is an early preview of upcoming Mixarr 2.0.0 playlist intelligence features. Functionality may change before release.</p>
        <p className={styles.betaCardNote}>Preview only. No playlist behavior is changed by this card.</p>
      </article>

      <article className={`${styles.card} ${styles.betaOnlyCard}`}>
        <div className={styles.betaCardTop}>
          <ShieldAlert size={22} className={styles.cardIcon} />
          <span className={styles.betaBadge}>Preview</span>
        </div>
        <h3>Analysis Dashboard Preview</h3>
        <p>Future analysis views may bring library health, enrichment coverage, and automation readiness into one testing dashboard.</p>
        <p className={styles.betaCardNote}>Private beta messaging only. No sponsor or payment checks are enforced.</p>
      </article>
    </>
  );
}

export default async function Home() {
  const cookieStore = cookies();
  const sessionId = cookieStore.get("mixarr_session")?.value;
  const showExperimentalPreviewCards = sessionId ? (await Promise.all([
    isResolvedBetaFeatureEnabled("showBetaCards", { userId: sessionId }),
    isResolvedBetaFeatureEnabled("enableV2PreviewCards", { userId: sessionId }),
  ])).every(Boolean) : false;

  let user = null;
  let dashboardSummary: DashboardSummary | null = null;
  let jobSummary: Awaited<ReturnType<typeof getRecentJobSummary>> | null = null;
  let recipeCount = 0;
  let generatedPlaylistCount = 0;
  let playlistHistoryCount = 0;
  let lastPlaylistHistoryEvent: { playlistName: string; eventType: string; createdAt: Date } | null = null;
  if (sessionId) {
    user = await prisma.user.findUnique({
      where: { id: sessionId },
    });
    if (user) {
      const [dashboardResult, jobsResult, recipesResult, generatedPlaylistsResult, playlistHistorySummary] = await Promise.all([
        getDashboardSummary(user.id).catch((error) => {
          console.error("[Dashboard] Initial summary failed", error);
          return null;
        }),
        getRecentJobSummary(user.id),
        prisma.playlistRecipe.count({ where: { userId: user.id, isArchived: false } }),
        prisma.generatedPlaylist.count({ where: { userId: user.id } }),
        getPlaylistHistoryDashboardSummary(user.id),
      ]);
      dashboardSummary = dashboardResult;
      jobSummary = jobsResult;
      recipeCount = recipesResult;
      generatedPlaylistCount = generatedPlaylistsResult;
      playlistHistoryCount = playlistHistorySummary.count;
      lastPlaylistHistoryEvent = playlistHistorySummary.lastEvent;
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
          <WorkerHealthCard />
          <DashboardSummaryCards initialSummary={dashboardSummary} />
          <div className={styles.compactCardsGrid}>
            <RecentlyAddedDiscoveryCard />
            <RecentJobsCard summary={jobSummary} />
            <SmartBuilderCard />

            <RecentlyAddedDiscoveryCard />
            <PlaylistRecipesCard count={recipeCount} />
            <PlaylistRegenerationCard count={generatedPlaylistCount} />
            <PlaylistHistoryCard count={playlistHistoryCount} lastEvent={lastPlaylistHistoryEvent} />
            <MixarrVersionCard />
            {showExperimentalPreviewCards && <BetaDashboardPreviewCards />}
            <Link href="/roadmap" className={`${styles.card} ${styles.roadmapCard}`}>
              <Map size={22} className={styles.cardIcon} />
              <h3>Mixarr Product Roadmap</h3>
              <p>See the completed Smart Mix v2 cycle and the current v2.1.x personalization cycle.</p>
              <span className={styles.cardAction}>View Roadmap</span>
            </Link>
          </div>
          <section className={styles.comingSoonSection} aria-labelledby="coming-soon-v2">
            <div className={styles.comingSoonHeader}>
              <div>
                <span className={styles.kicker}>Preview</span>
                <h3 id="coming-soon-v2">Current v2.1.x Cycle</h3>
                <p>Optional, local personalization now builds on Smart Mix Engine v2.</p>
              </div>
              <span className={styles.versionPill}>v2.1.x</span>
            </div>
            <p className={styles.enrichmentNote}>
              Data enrichment controls now live in a dedicated section for BPM, audio features, genres, popularity, local analysis, preflight checks, and Library Health links.
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

            <GuestDataEnrichmentDashboardCard />

            <PlaylistRecipesCard count={0} />

            <PlaylistRegenerationCard count={0} />

            <PlaylistHistoryCard count={0} lastEvent={null} />

            <SmartBuilderCard />

            {showExperimentalPreviewCards && <BetaDashboardPreviewCards />}

            <Link href="/roadmap" className={`${styles.card} ${styles.roadmapCard}`}>
              <Map size={24} className={styles.cardIcon} />
              <h3>Mixarr Product Roadmap</h3>
              <p>See completed releases and the current personalization cycle.</p>
              <span className={styles.cardAction}>View Roadmap</span>
            </Link>
          </div>
        </div>
      )}

      <div className={styles.recentSection}>
        <div className={styles.sectionHeader}>
          <h3>Recent Playlists</h3>
          <Link href="/generated-playlists" className={styles.viewAll}>View All &rarr;</Link>
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
