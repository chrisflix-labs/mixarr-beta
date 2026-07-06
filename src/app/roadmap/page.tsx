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
  "Recipe sharing gallery",
  "Export playlist history",
  "Restore previous playlist version",
  "Advanced Smart Mix Engine",
  "Mood blending",
  "BPM transition/ramp tools",
  "Deep cut / discovery tuning",
  "Recently added automation",
  "Beta experimental features",
];

const currentReleaseFeatures = [
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
          <p>This release cleans up navigation so desktop sections are easier to scan and mobile navigation no longer crowds long labels into the bottom bar.</p>
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
            <span className={styles.kicker}>Next</span>
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
        <p className={styles.futureNote}>Recipe sharing gallery, playlist history export, restore previous version, mood blending, BPM transition/ramp tools, recently added automation, and deeper discovery tuning are planned for future releases.</p>
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
