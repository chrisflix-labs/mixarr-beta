import Link from "next/link";
import { cookies } from "next/headers";
import {
  Activity, BookMarked, ChevronDown, Clock3, FlaskConical, History, Network,
  LifeBuoy, ListMusic, ListRestart, Map, ScrollText, ShieldAlert,
  Sparkles, Wand2,
} from "lucide-react";
import styles from "./page.module.css";
import DashboardSummaryCards from "@/components/DashboardSummaryCards";
import LibrarySelector from "@/components/LibrarySelector";
import PlexLoginButton from "@/components/PlexLoginButton";
import RecentlyAddedDiscoveryCard from "@/components/RecentlyAddedDiscoveryCard";
import SyncProgress from "@/components/SyncProgress";
import WorkerHealthCard from "@/components/WorkerHealthCard";
import { getAutomationOverview } from "@/lib/automation";
import { APP_VERSION } from "@/lib/appVersion";
import { getDashboardSummary, type DashboardSummary } from "@/lib/dashboardSummary";
import { dashboardWidgetsForSection } from "@/lib/dashboardWidgets";
import { isFeatureEnabled as isResolvedBetaFeatureEnabled } from "@/lib/featureFlagService";
import { getRecentJobSummary } from "@/lib/jobHistory";
import { getPlaylistHistoryDashboardSummary } from "@/lib/playlistHistory";
import prisma from "@/lib/prisma";
import { getRecentlyAddedSummary } from "@/lib/recentlyAdded";
import { getOrchestrationSettings } from "@/lib/orchestration/settings";
import { getSmartRefreshDashboardSummary } from "@/lib/smartRefresh";

type JobSummary = Awaited<ReturnType<typeof getRecentJobSummary>>;
type AutomationOverview = Awaited<ReturnType<typeof getAutomationOverview>>;
type RecentlyAddedSummary = Awaited<ReturnType<typeof getRecentlyAddedSummary>>;

function SectionHeading({ id, title, description }: { id: string; title: string; description: string }) {
  return <div className={styles.sectionHeading}><div><h2 id={id}>{title}</h2><p>{description}</p></div></div>;
}

function SmartBuilderCard() {
  return <article className={styles.actionCard}>
    <span className={styles.actionIcon}><Sparkles size={19} /></span>
    <h3>Smart Playlist Builder</h3>
    <p>Build a guided mix, then tune mood, tempo, discovery, and flow.</p>
    <div className={styles.cardActions}><Link href="/smart-builder" className={styles.primaryAction}>Open Smart Builder</Link><Link href="/builder" className={styles.secondaryAction}>Advanced Builder</Link></div>
  </article>;
}

function PlaylistRecipesCard({ count }: { count: number }) {
  return <article className={styles.actionCard}>
    <span className={styles.actionIcon}><BookMarked size={19} /></span>
    <h3>Playlist Recipes</h3>
    <p>Reuse, import, and share saved playlist configurations.</p>
    <span className={styles.cardMeta}>{count.toLocaleString()} saved recipe{count === 1 ? "" : "s"}</span>
    <div className={styles.cardActions}><Link href="/recipes" className={styles.primaryAction}>View Recipes</Link></div>
  </article>;
}

function PlaylistRegenerationCard({ count }: { count: number }) {
  return <article className={styles.actionCard}>
    <span className={styles.actionIcon}><ListRestart size={19} /></span>
    <h3>Playlist Regeneration</h3>
    <p>Refresh an existing Mixarr playlist with previews and safety rules.</p>
    <span className={styles.cardMeta}>{count.toLocaleString()} generated playlist{count === 1 ? "" : "s"}</span>
    <div className={styles.cardActions}><Link href="/generated-playlists" className={styles.primaryAction}>Manage Playlists</Link></div>
  </article>;
}

function ActivityAutomationCard({ jobs, automation, nextRun }: { jobs: JobSummary | null; automation: AutomationOverview | null; nextRun: Date | string | null | undefined }) {
  const job = jobs?.lastJob;
  const active = job && ["queued", "retrying", "running", "processing", "pending", "active", "in_progress"].includes(job.status.toLowerCase());
  return <article className={`${styles.activityCard} ${active ? styles.activeJob : ""}`}>
    <div className={styles.cardTopline}><div className={styles.cardTitle}><Activity size={20} /><h3>Activity & Automation</h3></div>{active && <span className={styles.statusBadge} data-status="running">Active job</span>}</div>
    <div className={styles.activityColumns}>
      <div>
        <span className={styles.eyebrow}>Latest job</span>
        {job ? <div className={styles.latestJob}><b>{job.name}</b><span className={styles.statusBadge} data-status={active ? "running" : job.status.toLowerCase()}>{job.status.replaceAll("_", " ")}</span><small>{job.finishedAt ? job.finishedAt.toLocaleString() : "In progress"}</small></div> : <p className={styles.emptyText}>No jobs recorded yet.</p>}
        <p className={jobs?.recentFailures ? styles.warningText : styles.mutedLine}>{jobs?.recentFailures || 0} recent failure{jobs?.recentFailures === 1 ? "" : "s"}</p>
      </div>
      <div>
        <span className={styles.eyebrow}>Automation</span>
        {automation ? <div className={styles.automationSummary}>
          <b>{automation.policy.preset.toLowerCase().replace(/^./, (letter) => letter.toUpperCase())}{automation.policy.isCustom ? " · Custom" : ""}</b>
          <span>{automation.completedToday} completed today · {automation.pendingApprovals} awaiting approval</span>
          <span><Clock3 size={12} /> {nextRun ? `Next ${new Date(nextRun).toLocaleString()}` : "No scheduled automation"}</span>
          {automation.policy.paused && <strong>Automation is paused</strong>}
        </div> : <p className={styles.emptyText}>Automation status is unavailable.</p>}
      </div>
    </div>
    <div className={styles.cardActions}><Link href="/job-history" className={styles.primaryAction}>View Job History</Link><Link href="/automation" className={styles.secondaryAction}>Manage Automation</Link></div>
  </article>;
}

function PlaylistManagementCard({ historyCount, generatedCount, versionCount, recipeCount, groupSummary, lastEvent }: { historyCount: number; generatedCount: number; versionCount: number; recipeCount: number; groupSummary: { groups: number; groupedPlaylists: number; attention: number; paused: number }; lastEvent: { playlistName: string; eventType: string; createdAt: Date } | null }) {
  return <article className={styles.managementCard}>
    <div className={styles.cardTitle}><History size={20} /><div><h3>Playlist Management</h3><p>History and saved assets, without repeating creation actions.</p></div></div>
    <div className={styles.managementMetrics}>
      <Link href="/playlist-history"><b>{historyCount.toLocaleString()}</b><span>History entries</span></Link>
      <Link href="/generated-playlists"><b>{generatedCount.toLocaleString()}</b><span>Generated playlists</span></Link>
      <Link href="/generated-playlists"><b>{versionCount.toLocaleString()}</b><span>Playlist versions</span></Link>
      <Link href="/recipes"><b>{recipeCount.toLocaleString()}</b><span>Saved recipes</span></Link>
    </div>
    <div className={styles.managementFooter}><span><b>Playlist Collections:</b> {groupSummary.groups} collections · {groupSummary.groupedPlaylists} grouped playlists · {groupSummary.attention} need attention · {groupSummary.paused} paused</span><Link href="/playlist-groups" className={styles.secondaryAction}>Manage Collections</Link></div>
    <div className={styles.managementFooter}><span>{lastEvent ? `Latest: ${lastEvent.playlistName} · ${lastEvent.createdAt.toLocaleString()}` : "No playlists generated yet."}</span><Link href="/playlist-history" className={styles.secondaryAction}>View Playlist History</Link></div>
  </article>;
}

function OrchestrationSummaryCard({ summary }: { summary: { managed: number; running: number; queued: number; blocked: number; enabled: boolean } }) {
  return <article className={styles.managementCard}>
    <div className={styles.cardTitle}><Network size={20} /><div><h3>Playlist Orchestration</h3><p>Shared queue and dependency-safe automation.</p></div></div>
    <div className={styles.managementMetrics}>
      <Link href="/orchestration"><b>{summary.managed}</b><span>Managed</span></Link>
      <Link href="/orchestration"><b>{summary.running}</b><span>Running</span></Link>
      <Link href="/orchestration"><b>{summary.queued}</b><span>Queued</span></Link>
      <Link href="/orchestration"><b>{summary.blocked}</b><span>Blocked</span></Link>
    </div>
    <div className={styles.managementFooter}><span>Automation: {summary.enabled ? "Enabled" : "Disabled"}</span><Link href="/orchestration" className={styles.secondaryAction}>Open Orchestration</Link></div>
  </article>;
}

function SmartRefreshSummaryCard({ summary }: { summary: Awaited<ReturnType<typeof getSmartRefreshDashboardSummary>> }) {
  return <article className={styles.managementCard}>
    <div className={styles.cardTitle}><Sparkles size={20} /><div><h3>Smart Refresh</h3><p>Meaningful playlist improvements, gated by estimates and safeguards.</p></div></div>
    <div className={styles.managementMetrics}>
      <Link href="/generated-playlists"><b>{summary.monitored}</b><span>Monitored</span></Link>
      <Link href="/generated-playlists?smartRefresh=recommended"><b>{summary.recommended}</b><span>Recommended</span></Link>
      <Link href="/generated-playlists?smartRefresh=deferred"><b>{summary.deferred}</b><span>Deferred</span></Link>
      <Link href="/generated-playlists?smartRefresh=healthy"><b>{summary.healthy}</b><span>Healthy</span></Link>
    </div>
    {summary.playlists.length > 0 && <div className={styles.managementFooter}><span>{summary.playlists.slice(0, 3).map((playlist) => `${playlist.name} +${playlist.estimatedImprovement || 0}`).join(" · ")}</span><Link href="/generated-playlists" className={styles.secondaryAction}>Review recommendations</Link></div>}
  </article>;
}

function ProductPreviewPanel({ showExperimental }: { showExperimental: boolean }) {
  return <details className={styles.productPanel}>
    <summary>
      <span className={styles.cardTitle}><ScrollText size={19} /><span><b>Product & Preview</b><small>{APP_VERSION} · Release information and what’s next</small></span></span>
      <span className={styles.productSummaryMeta}>{showExperimental ? "2 experimental · 1 preview" : "Preview details"}<ChevronDown size={17} /></span>
    </summary>
    <div className={styles.productContent}>
      <div className={styles.productLinks}>
        <Link href="/release-notes"><ScrollText size={17} /><span><b>Release Notes</b><small>What changed in {APP_VERSION}</small></span></Link>
        <Link href="/roadmap"><Map size={17} /><span><b>Full Roadmap</b><small>Completed v2.1.x and the proposed v2.2.x direction</small></span></Link>
        <Link href="/support"><LifeBuoy size={17} /><span><b>Beta Support</b><small>Diagnostics and support resources</small></span></Link>
      </div>
      <div className={styles.whatsNext}><span className={styles.eyebrow}>What’s Next</span><p>Lifecycle-aware playlist maintenance, safer scheduled regeneration, and stronger automation observability.</p><Link href="/roadmap" className={styles.secondaryAction}>View Full Roadmap</Link></div>
      {showExperimental && <div className={styles.experimentalList}>
        <div><FlaskConical size={17} /><span><b>Experimental Playlist Intelligence</b><small>Early preview only; existing playlist behavior is unchanged.</small></span><em>Experimental</em></div>
        <div><ShieldAlert size={17} /><span><b>Analysis Dashboard Preview</b><small>Private beta preview with no new sponsor or payment checks.</small></span><em>Preview</em></div>
      </div>}
    </div>
  </details>;
}

export default async function Home({ searchParams }: { searchParams?: { dashboardPreview?: string } }) {
  const sessionId = cookies().get("mixarr_session")?.value;
  const developmentPreview = process.env.NODE_ENV === "development" && searchParams?.dashboardPreview === "1";
  const user = developmentPreview
    ? { id: "dashboard-preview" }
    : sessionId
      ? await prisma.user.findUnique({ where: { id: sessionId } })
      : null;

  let dashboardSummary: DashboardSummary | null = null;
  let jobs: JobSummary | null = null;
  let automation: AutomationOverview | null = null;
  let recentlyAdded: RecentlyAddedSummary | null = null;
  let recipeCount = 0;
  let generatedCount = 0;
  let versionCount = 0;
  let historyCount = 0;
  let lastHistoryEvent: { playlistName: string; eventType: string; createdAt: Date } | null = null;
  let showExperimental = false;
  let orchestration = { managed: 0, running: 0, queued: 0, blocked: 0, enabled: false };
  let groupSummary = { groups: 0, groupedPlaylists: 0, attention: 0, paused: 0 };
  let smartRefresh = { monitored: 0, recommended: 0, deferred: 0, healthy: 0, fixedSchedule: 0, manualOnly: 0, playlists: [] } as Awaited<ReturnType<typeof getSmartRefreshDashboardSummary>>;

  if (user && !developmentPreview) {
    const results = await Promise.all([
      getDashboardSummary(user.id).catch((error) => { console.error("[Dashboard] readiness failed", error); return null; }),
      getRecentJobSummary(user.id).catch((error) => { console.error("[Dashboard] jobs failed", error); return null; }),
      getAutomationOverview(user.id).catch((error) => { console.error("[Dashboard] automation failed", error); return null; }),
      getRecentlyAddedSummary(user.id).catch((error) => { console.error("[Dashboard] Recently Added failed", error); return null; }),
      prisma.playlistRecipe.count({ where: { userId: user.id, isArchived: false } }).catch(() => 0),
      prisma.generatedPlaylist.count({ where: { userId: user.id } }).catch(() => 0),
      prisma.playlistRevision.count({ where: { generatedPlaylist: { userId: user.id } } }).catch(() => 0),
      getPlaylistHistoryDashboardSummary(user.id).catch(() => ({ count: 0, lastEvent: null })),
      Promise.all([
        isResolvedBetaFeatureEnabled("showBetaCards", { userId: user.id }),
        isResolvedBetaFeatureEnabled("enableV2PreviewCards", { userId: user.id }),
      ]).then((flags) => flags.every(Boolean)).catch(() => false),
      Promise.all([
        prisma.managedPlaylist.count({ where: { userId: user.id, enabled: true } }),
        prisma.playlistOrchestrationJob.count({ where: { userId: user.id, status: "RUNNING" } }),
        prisma.playlistOrchestrationJob.count({ where: { userId: user.id, status: "QUEUED" } }),
        prisma.playlistOrchestrationJob.count({ where: { userId: user.id, status: { in: ["WAITING", "BLOCKED"] } } }),
        getOrchestrationSettings(),
      ]).then(([managed, running, queued, blocked, settings]) => ({ managed, running, queued, blocked, enabled: settings.enabled })).catch(() => ({ managed: 0, running: 0, queued: 0, blocked: 0, enabled: false })),
      Promise.all([
        prisma.playlistGroup.count({ where: { userId: user.id } }),
        prisma.playlistGroupMembership.findMany({ where: { playlistGroup: { userId: user.id } }, distinct: ["playlistId"], select: { playlistId: true } }).then((rows) => rows.length),
        prisma.playlistGroup.count({ where: { userId: user.id, isPaused: true } }),
        prisma.playlistGroup.count({ where: { userId: user.id, memberships: { some: { playlist: { OR: [{ trackCount: 0 }, { engineVersion: { not: "v2" } }] } } } } }),
      ]).then(([groups, groupedPlaylists, paused, attention]) => ({ groups, groupedPlaylists, paused, attention })).catch(() => ({ groups: 0, groupedPlaylists: 0, attention: 0, paused: 0 })),
      getSmartRefreshDashboardSummary(user.id).catch(() => ({ monitored: 0, recommended: 0, deferred: 0, healthy: 0, fixedSchedule: 0, manualOnly: 0, playlists: [] })),
    ]);
    [dashboardSummary, jobs, automation, recentlyAdded, recipeCount, generatedCount, versionCount] = results;
    historyCount = results[7].count;
    lastHistoryEvent = results[7].lastEvent;
    showExperimental = results[8];
    orchestration = results[9];
    groupSummary = results[10];
    smartRefresh = results[11];
  }

  const quickWidgets = dashboardWidgetsForSection("quick-actions");
  const activityWidgets = dashboardWidgetsForSection("activity-automation");

  return <main className={styles.dashboard}>
    <header className={styles.dashboardHeader}>
      <div><span className={styles.eyebrow}>Library operations</span><h1>Dashboard</h1><p>See what is ready, what is running, and where to build your next mix.</p></div>
      <div className={styles.headerActions}><span className={styles.versionBadge}>{APP_VERSION}</span>{dashboardSummary && <small>Updated {new Date(dashboardSummary.loadedAt).toLocaleTimeString()}</small>}<Link href="/builder" className={styles.primaryAction}><Wand2 size={16} /> Build Playlist</Link></div>
    </header>

    {user ? <>
      <section className={styles.dashboardSection} aria-labelledby="library-readiness-heading">
        <SectionHeading id="library-readiness-heading" title="Library Readiness" description="Plex sync and enrichment coverage in one operational summary." />
        {dashboardWidgetsForSection("library-readiness").map((widget) => <DashboardSummaryCards key={widget.id} initialSummary={dashboardSummary} />)}
        <details className={styles.syncControls}><summary><span><ListMusic size={17} /> Sync & enrichment controls</span><ChevronDown size={17} /></summary><div><SyncProgress /></div></details>
      </section>

      <section className={styles.dashboardSection} aria-labelledby="quick-actions-heading">
        <SectionHeading id="quick-actions-heading" title="Quick Actions" description="Common playlist workflows, kept close at hand." />
        <div className={styles.quickActionsGrid}>{quickWidgets.map((widget) => {
          if (widget.component === "SmartBuilder") return <SmartBuilderCard key={widget.id} />;
          if (widget.component === "RecentlyAddedDiscovery") return <RecentlyAddedDiscoveryCard key={widget.id} summary={recentlyAdded} />;
          if (widget.component === "PlaylistRecipes") return <PlaylistRecipesCard key={widget.id} count={recipeCount} />;
          return <PlaylistRegenerationCard key={widget.id} count={generatedCount} />;
        })}</div>
      </section>

      <section className={styles.dashboardSection} aria-labelledby="activity-heading">
        <SectionHeading id="activity-heading" title="Activity & Automation" description="Current work, recent warnings, and automation status." />
        <div className={styles.activityGrid}>{activityWidgets.map((widget) => widget.component === "ActivityAutomation"
          ? <ActivityAutomationCard key={widget.id} jobs={jobs} automation={automation} nextRun={recentlyAdded?.nextScheduledRunAt} />
          : <div key={widget.id} className={styles.workerSlot}><WorkerHealthCard compact /></div>)}</div>
      </section>

      <section className={styles.dashboardSection} aria-labelledby="playlist-management-heading">
        <SectionHeading id="playlist-management-heading" title="Playlist Management" description="A compact view of generated playlists, versions, history, and recipes." />
        {dashboardWidgetsForSection("playlist-management").map((widget) => <PlaylistManagementCard key={widget.id} historyCount={historyCount} generatedCount={generatedCount} versionCount={versionCount} recipeCount={recipeCount} groupSummary={groupSummary} lastEvent={lastHistoryEvent} />)}
        <OrchestrationSummaryCard summary={orchestration} />
        <SmartRefreshSummaryCard summary={smartRefresh} />
      </section>

      <section className={`${styles.dashboardSection} ${styles.lowPrioritySection}`} aria-label="Product and preview information">
        {dashboardWidgetsForSection("product-preview").map((widget) => <ProductPreviewPanel key={widget.id} showExperimental={showExperimental} />)}
      </section>

      <section id="plex-servers" className={styles.dashboardSection} aria-labelledby="plex-servers-heading">
        <SectionHeading id="plex-servers-heading" title="Plex Servers" description="Connected servers and music libraries. Detailed management remains in settings and Library Health." />
        {dashboardWidgetsForSection("plex-servers").map((widget) => <LibrarySelector key={widget.id} compact />)}
      </section>
    </> : <section className={styles.signInPanel}>
      <ListMusic size={28} /><h2>Connect your Plex library</h2><p>Sign in to sync music, review library readiness, and build curated playlists.</p><PlexLoginButton />
      <div className={styles.guestLinks}><Link href="/release-notes">Release Notes</Link><Link href="/roadmap">Roadmap</Link><Link href="/support">Beta Support</Link></div>
    </section>}
  </main>;
}
