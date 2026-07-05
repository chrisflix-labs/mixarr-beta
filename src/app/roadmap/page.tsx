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
  "Webhook-triggered recently-added scans",
  "Smart playlist builder",
  "Advanced playlist regeneration",
  "Artist variety controls",
  "Artist/album exclusion rules",
  "Import/export recipes",
  "Recipe sharing",
];

const currentReleaseFeatures = [
  "Playlist safety rules",
  "Avoid same-artist back-to-back tracks",
  "Max tracks per artist and album controls",
  "Low-track-count playlist warnings",
  "Safety summaries in preview and Job History",
];

const v2Ideas = [
  "Smart Mix Engine",
  "Guided playlist creation",
  "Built-in mood and activity presets",
  "Advanced playlist regeneration",
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
          <p>This release adds basic Playlist Safety Rules so generated previews can avoid repetitive artist runs, album pileups, and very small playlist results.</p>
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
        <p className={styles.futureNote}>Webhook-triggered scans, Smart Mix Engine work, and broader artist or album exclusion rules are planned for future releases.</p>
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
