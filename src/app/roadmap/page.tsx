import styles from "./roadmap.module.css";
import Link from "next/link";
import { CalendarCheck, FlaskConical, HeartHandshake, MessageCircle, Rocket, Sparkles } from "lucide-react";
import { APP_VERSION } from "@/lib/appVersion";
import { MIXARR_BETA_DISCORD_URL } from "@/lib/releaseNotes";

export const metadata = {
  title: "Roadmap | Mixarr",
  description: "Mixarr roadmap, coming soon features, and v2.0.0 preview",
};

const completedV13Items = [
  "Library Health Accuracy",
  "Audio Feature Retry Improvements",
  "Local Audio Analysis Polish",
  "Data Enrichment Cleanup",
  "BPM Confidence & Source Improvements",
  "Mood & Energy Sync Improvements",
  "Background Worker Reliability",
  "Plex Matching & Track Sync Polish",
  "Beta Feedback & Discord Support Polish",
  "v2.0.0 Readiness & Beta Hardening",
];

const v2RoadmapItems = [
  "Smart Mix Engine v2",
  "Playlist scoring",
  "Recommendation tuning",
  "Deep cut/discovery controls",
  "Mood blending",
  "BPM ramp/transition tools",
  "Advanced playlist regeneration",
  "Restore previous playlist version",
  "Manual BPM correction",
  "Recently added automation",
  "Experimental beta features",
];

const previewBullets = [
  "Smart Mix Engine v2",
  "Playlist scoring",
  "Mood blending",
  "BPM transition tools",
  "Deep cut and discovery tuning",
];

export default function RoadmapPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>
            <Rocket size={14} />
            Roadmap
          </span>
          <h2>Roadmap to v2.0.0</h2>
          <p>
            The v1.3.x cycle focused on reliability, Library Health accuracy, enrichment cleanup, worker stability,
            and beta support. The next cycle begins the v2.0.0 Smart Mix Engine work.
          </p>
        </div>
      </header>

      <section className={styles.releasePanel} aria-labelledby="current-release">
        <div className={styles.panelIcon}>
          <CalendarCheck size={20} />
        </div>
        <div>
          <span className={styles.badge}>Current / completed</span>
          <h3 id="current-release">v1.3.9 - v2.0.0 Readiness &amp; Beta Hardening</h3>
          <p>
            Mixarr {APP_VERSION} closes the v1.3.x reliability and data-foundation cycle with startup readiness checks,
            safer diagnostics, clearer configuration validation, and release visibility cleanup.
          </p>
          <p>v1.3.9.1 fixed a false database error in App Readiness.</p>
          <div className={styles.currentReleaseList}>
            {completedV13Items.map((feature) => (
              <span key={feature}>{feature}</span>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.teaser} aria-labelledby="v2-preview">
        <div className={styles.teaserTop}>
          <span className={styles.teaserIcon}>
            <Sparkles size={20} />
          </span>
          <span className={styles.versionPill}>v2.0.0</span>
        </div>
        <h3 id="v2-preview">Coming in v2.0.0</h3>
        <p>
          The v2.0.0 cycle focuses on smarter playlist generation, better recommendations, playlist scoring, and
          advanced Smart Mix behavior.
        </p>
        <div className={styles.ideaGrid}>
          {previewBullets.map((idea) => (
            <span key={idea}>{idea}</span>
          ))}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="v2-roadmap">
        <div className={styles.sectionHeader}>
          <div>
            <span className={styles.kicker}>v2.0.0</span>
            <h3 id="v2-roadmap">Smart Mix Engine v2 Roadmap</h3>
          </div>
          <p>v2.0.0 is the smarter playlist engine cycle, building on the v1.3.x reliability and metadata foundation.</p>
        </div>
        <div className={styles.featureGrid}>
          {v2RoadmapItems.map((feature) => (
            <article key={feature} className={styles.featureCard}>
              <span aria-hidden="true" />
              <p>{feature}</p>
            </article>
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
            {MIXARR_BETA_DISCORD_URL ? (
              <a href={MIXARR_BETA_DISCORD_URL} target="_blank" rel="noopener noreferrer">
                {MIXARR_BETA_DISCORD_URL}
              </a>
            ) : (
              <Link href="/support">Open Beta Support</Link>
            )}
          </div>
        </article>

        <article className={styles.callout}>
          <div className={styles.calloutIcon}>
            <HeartHandshake size={18} />
          </div>
          <div>
            <h3>Beta access</h3>
            <p>Beta builds will keep prioritizing safe defaults, explicit user actions, and clear diagnostics.</p>
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
