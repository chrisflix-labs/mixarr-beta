import styles from "./roadmap.module.css";
import Link from "next/link";
import { CalendarCheck, FlaskConical, HeartHandshake, MessageCircle, Rocket, Sparkles } from "lucide-react";
import { APP_VERSION } from "@/lib/appVersion";
import { MIXARR_BETA_DISCORD_URL } from "@/lib/releaseNotes";

export const metadata = {
  title: "Roadmap | Mixarr",
  description: "Mixarr roadmap, coming soon features, and v2.0.0 preview",
};

const nextFeatures = [
  "Better recommendations",
  "Deep cut / discovery tuning",
  "Playlist scoring",
  "Smart Mix Engine groundwork",
  "Mood blending",
  "BPM transition/ramp tools",
  "Restore previous playlist version",
  "Recently added automation",
  "Beta experimental features",
  "Manual BPM correction",
];

const currentReleaseFeatures = [
  "v1.3.7.1 removed the Healthy Tracks card from Library Health to improve page performance.",
  "v1.3.7 completes Plex Matching & Track Sync Polish.",
  "Plex sync now prefers stable track identifiers before metadata fallbacks.",
  "Moved files, renamed tracks, restored tracks, and missing-from-Plex records are handled without unsafe deletion or duplicate creation.",
  "Plex sync summaries now include scanned, matched, added, updated, moved, renamed, missing, restored, duplicate, and conflict counts.",
  "Library Health now exposes Plex sync diagnostics for missing-from-Plex tracks, missing local files, duplicate candidates, match conflicts, moved files, and renamed tracks.",
  "Duplicate candidates and match conflicts are visible without automatic merge or delete actions.",
  "v1.3.6 completes Background Worker Reliability.",
  "Dashboard, Job History, and Settings now show background worker health, heartbeat age, queue depth, stale jobs, active locks, and scheduler diagnostics.",
  "Worker startup now runs a self-check, detects stale or interrupted running jobs, and safely recovers enrichment and analysis work where possible.",
  "Long-running sync and enrichment jobs now carry worker ownership, lock keys, heartbeat/progress timestamps, and lease expiry metadata.",
  "Duplicate long-running jobs and overlapping scheduled syncs are blocked or skipped with clearer Job History messages.",
  "Unsafe playlist jobs are not blindly requeued after a restart.",
  "v1.3.5 completes Mood & Energy Sync Improvements.",
  "Library Health now shows missing mood, missing energy, missing mood & energy, partial mood/energy, pending mood/energy, and mood/energy failed categories.",
  "Mood and energy rows now include compact source and confidence labels where available.",
  "Data Enrichment now summarizes mood and energy completeness and exposes targeted mood/energy retry actions.",
  "Smart Builder and Playlist Preview now explain when missing mood or energy may reduce mood preset matches.",
  "v1.3.4 completes BPM Confidence & Source Improvements.",
  "BPM values now show clearer local, API, imported, estimated, manual, and unknown source labels.",
  "Library Health BPM detail views now include effective BPM, source, confidence, source values, and reason text.",
  "Low-confidence BPM values and BPM source conflicts are easier to find from Library Health and Data Enrichment.",
  "Dashboard and Data Enrichment now summarize local/API/imported BPM coverage, low confidence values, and possible conflicts.",
  "Playlist previews include compact BPM source and confidence context.",
  "v1.3.3 completes Data Enrichment Cleanup.",
  "Data Enrichment now has clear BPM, Audio Features, Genres, Popularity, and Local Audio Analysis sections.",
  "Enrichment actions now show provider mode, preflight matched/eligible/skipped counts, no-op explanations, and Library Health detail links.",
  "Job History and refresh behavior are clearer after enrichment jobs complete.",
  "v1.3.2 completes Local Audio Analysis Polish.",
  "Settings now shows Local Audio Analysis status, analyzer, scope, provider mode, API/local toggles, and reprocess behavior.",
  "Local Essentia retries now show preflight matched, eligible, skipped, and skip-reason counts.",
  "Local audio analysis progress now reports processed, skipped, failed, remaining, elapsed time, and scope.",
  "Completion and Job History summaries now explain what changed after Local Essentia analysis.",
  "Health Accuracy Diagnostics now includes compact local analysis diagnostics.",
  "v1.3.1 completes Audio Feature Retry Improvements.",
  "Audio-feature retries now preflight matched, eligible, queued, skipped, and skip-reason counts before queueing.",
  "Partial, missing, pending, failed, skipped, and too-short audio-feature retries now start from the same Library Health resolved track sets as cards and detail views.",
  "Local Essentia retry now includes partial and pending tracks with local files instead of requiring a completed local row first.",
  "API-only and local-only retry modes now explain disabled provider states clearly.",
  "Audio-feature retry Job History entries now include filter, retry mode, provider mode, counts, skip reasons, and summaries.",
  "Library Health and dashboard counts refresh after audio-feature retry jobs complete.",
  "v1.3.0.1 fixed stale Audio Features health card counts after sync/reprocess completion.",
  "v1.3.0 completes Library Health Accuracy.",
  "Library Health cards, detail rows, retry actions, diagnostics, and exports now use shared category resolution.",
  "Health Accuracy Diagnostics now checks audio features, BPM, genres, popularity, and local file invariants.",
  "Retry actions now record matched, queued, skipped, skip reasons, and provider mode in Job History.",
  "BPM-present incomplete audio tracks remain classified as Partial Audio Features.",
  "Health diagnostics export makes future bug reports easier without including credentials.",
  "v1.2.9.1 fixed Matching Rules layout overflow before v1.3.0 development begins.",
  "v1.2.9 completes Playlist Builder UI Fix as the final v1.2.x polish release before v1.3.0 feature development.",
  "Playlist Builder preview panels now stay contained after generating a playlist preview.",
  "Previewed Tracks table sizing and overflow are easier to read at desktop and mobile widths.",
  "Repeated-artist warnings now stay quiet when max tracks per artist allows the repeats.",
  "Safety-rule messaging now distinguishes successful variety rules from actual problems.",
  "v1.2.8-hotfix.7 fixes Audio Feature Health showing zero incomplete categories while the dashboard reported incomplete tracks.",
  "v1.2.8-hotfix.6 fixes BPM-present incomplete tracks being classified as missing instead of partial audio features.",
  "v1.2.8-hotfix.4 fixes Library Health card/detail mismatches with shared track ID resolution for audio feature gaps.",
  "v1.2.8-hotfix.3 fixes audio gap detail queries so Missing and Pending Audio Features track lists match summary counts.",
  "v1.2.8-hotfix.2 merges detected audio feature gaps into visible Library Health summary counts.",
  "v1.2.8-hotfix fixed unclassified audio feature gaps for active tracks without audio feature records.",
  "v1.2.8 completes the Audio Feature Health Consistency Fix.",
  "Library Health audio feature summaries now match their track detail filters",
  "Missing, partial, and pending audio feature views use the current provider mode",
  "Incomplete audio feature rows now explain the missing or partial data",
  "Audio feature retries target the same filters shown in Library Health",
  "Dashboard audio feature wording now shows exact incomplete counts",
  "v1.2.7 completes Navigation Cleanup for desktop and mobile.",
  "Desktop sidebar navigation is grouped into Playlists, Library, and Activity sections",
  "Playlist tools, library tools, and activity pages are easier to scan",
  "Mobile bottom navigation is reduced to Dashboard, Build, Smart, Recipes, and More",
  "Secondary mobile pages now live in a grouped More menu",
  "Mobile version, GitHub, and Beta controls moved out of the crowded bottom area",
  "v1.2.6 adds Export/Import Mixarr Recipes for backups, moves, and sharing.",
  "Export individual recipes or all saved recipes as stable Mixarr JSON files",
  "Import recipe files with validation and preview before saving",
  "Duplicate recipe names can be renamed automatically or skipped",
  "Recipe filters, Smart presets, Mood presets, BPM presets, and safety rules are preserved",
  "v1.2.5 adds Playlist History for created and regenerated playlists.",
  "Historical track snapshots preserve the exact order written to Plex",
  "Playlist creation and regeneration summaries include filters, recipes, presets, exclusions, and safety rules",
  "History details show track lists and regeneration comparison stats",
  "Generated Playlists now links to related playlist history",
  "v1.2.4 adds Advanced Playlist Regeneration controls for Mixarr-created playlists.",
  "Keep Some Existing Tracks regeneration with 25% and 50% keep amounts",
  "Prefer Different Tracks Than Last Time using generated playlist snapshots",
  "Regeneration comparison stats for kept, replaced, reused, avoided, and new tracks",
  "Remove from Generated Playlists without deleting Plex playlists",
  "v1.2.3 added Playlist Regeneration for Mixarr-created playlists.",
  "Generated Playlists page for viewing tracked playlist metadata",
  "Regeneration preview before replacing tracks in Plex",
  "Saved generation metadata for builder, Smart Builder, and recipe-created playlists",
  "Regeneration uses saved filters, presets, manual exclusions, and safety rules",
  "Playlist regeneration runs recorded in Job History",
  "v1.2.2-hotfix improved independent Smart Builder preset selection and changed the app badge to Beta.",
  "BPM range presets for the Smart Playlist Builder",
  "Slow, Medium, Upbeat, Dance, High Energy, and Wide Open tempo presets",
  "Playlist Preview BPM preset summaries and low-match warnings",
  "Saved recipe BPM preset metadata",
  "Mood presets for the Smart Playlist Builder",
  "Preset-generated mood, energy, and optional BPM ranges",
  "Playlist Preview mood preset summaries and warnings",
  "Saved recipe mood preset metadata",
  "Smart playlist builder",
  "Guided presets for Workout, Chill, Party, Focus, Driving, Discovery, Deep Cuts, Popular Favorites, and Balanced Mix",
  "Preset-generated BPM, energy, mood, popularity, and safety defaults",
  "Playlist preview before Smart Builder creates playlists",
  "Smart Builder setups saved as reusable playlist recipes",
  "Smart Builder preset details recorded in Job History",
];

const v2Ideas = [
  "Smart Mix Engine",
  "Guided playlist creation",
  "Built-in mood and activity presets",
  "Artist variety controls",
  "Deep cut / discovery mode",
  "Better local audio analysis tools",
  "Experimental beta features",
];

export default function RoadmapPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>
            <Rocket size={14} />
            Coming Soon
          </span>
          <h2>Roadmap to v2.0.0</h2>
          <p>
            Mixarr is starting the roadmap toward v2.0.0. Features will land gradually through smaller releases so the
            beta can stay useful, testable, and steady as it grows.
          </p>
        </div>
      </header>

      <section className={styles.releasePanel} aria-labelledby="current-release">
        <div className={styles.panelIcon}>
          <CalendarCheck size={20} />
        </div>
        <div>
          <span className={styles.badge}>Current release</span>
          <h3 id="current-release">Mixarr {APP_VERSION}</h3>
          <p>v1.3.7.1 removes the Healthy Tracks card from Library Health while keeping the v1.3.7 Plex Matching & Track Sync Polish work intact.</p>
          <div className={styles.currentReleaseList}>
            {currentReleaseFeatures.map((feature) => (
              <span key={feature}>{feature}</span>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="coming-next">
        <div className={styles.sectionHeader}>
          <div>
            <span className={styles.kicker}>v1.3.x</span>
            <h3 id="coming-next">What is coming next</h3>
          </div>
          <p>Planned features will be shaped by beta testing and smaller release milestones.</p>
        </div>
        <div className={styles.featureGrid}>
          {nextFeatures.map((feature) => (
            <article key={feature} className={styles.featureCard}>
              <span aria-hidden="true" />
              <p>{feature}</p>
            </article>
          ))}
        </div>
        <p className={styles.futureNote}>Plex Matching & Track Sync Polish is complete in v1.3.7, with v1.3.7.1 adding a small Library Health performance hotfix. The rest of v1.3.x will focus on recommendation quality, discovery tuning, playlist scoring, Smart Mix Engine groundwork, mood blending, BPM transition/ramp tools, restore/version workflows, recently added automation, beta experiments, and manual BPM correction.</p>
      </section>

      <section className={styles.teaser} aria-labelledby="v2-teaser">
        <div className={styles.teaserTop}>
          <span className={styles.teaserIcon}>
            <Sparkles size={20} />
          </span>
          <span className={styles.versionPill}>v2.0.0</span>
        </div>
        <h3 id="v2-teaser">Smart Mix Engine</h3>
        <p>
          Mixarr v2.0.0 will focus on the Smart Mix Engine, a smarter way to build Plex music playlists using mood,
          energy, BPM, popularity, genre, and library health data.
        </p>
        <div className={styles.ideaGrid}>
          {v2Ideas.map((idea) => (
            <span key={idea}>{idea}</span>
          ))}
        </div>
      </section>

      <section className={styles.communityGrid} aria-label="Community and beta access">
        <article className={styles.callout}>
          <div className={styles.calloutIcon}>
            <MessageCircle size={18} />
          </div>
          <div>
            <h3>Community feedback</h3>
            <p>Join Discord to follow development, give feedback, report bugs, and suggest roadmap ideas.</p>
            <a href={MIXARR_BETA_DISCORD_URL} target="_blank" rel="noopener noreferrer">
              {MIXARR_BETA_DISCORD_URL}
            </a>
          </div>
        </article>

        <article className={styles.callout}>
          <div className={styles.calloutIcon}>
            <HeartHandshake size={18} />
          </div>
          <div>
            <h3>Beta access</h3>
            <p>Want early access to beta builds and experimental features? Become a monthly GitHub supporter for Mixarr.</p>
          </div>
        </article>
      </section>

      <div className={styles.footerActions}>
        <Link href="/release-notes" className={styles.secondaryButton}>
          <FlaskConical size={16} />
          Release Notes
        </Link>
        <Link href="/" className={styles.primaryButton}>
          Back to Dashboard
        </Link>
      </div>
    </main>
  );
}
