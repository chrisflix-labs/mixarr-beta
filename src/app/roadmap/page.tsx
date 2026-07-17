import Link from "next/link";
import { Bot, CalendarCheck, CheckCircle2, FlaskConical, HeartHandshake, MessageCircle, Rocket, ShieldCheck, Sparkles } from "lucide-react";
import { MIXARR_BETA_DISCORD_URL } from "@/lib/releaseNotes";
import { aiExploration, currentRoadmapRelease, roadmapCycles, type RoadmapStatus } from "@/lib/roadmap";
import styles from "./roadmap.module.css";

export const metadata = { title: "Roadmap | Mixarr", description: "Mixarr product roadmap and current release cycle." };

const statusLabels: Record<RoadmapStatus, string> = { completed: "Completed", current: "Current cycle", upcoming: "Upcoming" };

export default function RoadmapPage() {
  const current = currentRoadmapRelease();
  return (
    <main className={styles.page}>
      <header className={styles.header}><div><span className={styles.kicker}><Rocket size={14} /> Product roadmap</span><h2>Mixarr Product Roadmap</h2><p>Completed work, the active release, and future themes—kept in one versioned roadmap source.</p></div></header>

      {roadmapCycles.map((cycle) => (
        <section key={cycle.id} className={`${styles.cycleCard} ${styles[cycle.status]}`} aria-labelledby={`cycle-${cycle.id}`}>
          <div className={styles.cycleHeader}>
            <span className={styles.panelIcon}>{cycle.status === "completed" ? <CheckCircle2 size={20} /> : <Sparkles size={20} />}</span>
            <div><span className={styles.badge}>{statusLabels[cycle.status]}</span><h3 id={`cycle-${cycle.id}`}>{cycle.title}</h3></div>
          </div>
          <p className={styles.cycleDescription}>{cycle.description}</p>
          <div className={styles.releaseList}>
            {cycle.releases.map((release) => (
              <article key={release.version} className={styles.releaseItem} data-status={release.status}>
                <div><span className={styles.versionPill}>v{release.version}</span><span className={styles.releaseStatus}>{release.status === "current" ? "Current" : release.status === "upcoming" ? "Proposed" : "Completed"}</span></div>
                <h4>{release.title}</h4>
                {release.status === "current" && <p>{release.description}</p>}
                {release.featureLabels.length > 0 && <div className={styles.ideaGrid}>{release.featureLabels.map((feature) => <span key={feature}>{feature}</span>)}</div>}
              </article>
            ))}
          </div>
          {cycle.futureThemes && <div className={styles.futureThemes}><h4>Later in this cycle</h4><p>No version numbers are assigned until scope is confirmed.</p><div className={styles.featureGrid}>{cycle.futureThemes.map((theme) => <article key={theme} className={styles.featureCard}><span aria-hidden="true" /><p>{theme}</p></article>)}</div></div>}
        </section>
      ))}

      <section className={styles.teaser} aria-labelledby="ai-exploration">
        <div className={styles.teaserTop}><span className={styles.teaserIcon}><Bot size={20} /></span><span className={styles.versionPill}>Exploratory · no committed version</span></div>
        <h3 id="ai-exploration">{aiExploration.title}</h3><p><strong>{aiExploration.timing}.</strong> {aiExploration.description}</p>
        <div className={styles.ideaGrid}>{aiExploration.ideas.map((idea) => <span key={idea}>{idea}</span>)}</div>
        <div className={styles.aiSafeguards}><h4><ShieldCheck size={17} /> Non-negotiable safeguards</h4><ul>{aiExploration.safeguards.map((item) => <li key={item}>{item}</li>)}</ul></div>
      </section>

      {current && <section className={styles.releasePanel} aria-labelledby="current-release"><div className={styles.panelIcon}><CalendarCheck size={20} /></div><div><span className={styles.badge}>Latest completed release</span><h3 id="current-release">v{current.version} — {current.title}</h3><p>{current.description}</p><Link href={current.route || "/release-notes"}>Open release feature</Link></div></section>}

      <section className={styles.communityGrid} aria-label="Community and beta access">
        <article className={styles.callout}><div className={styles.calloutIcon}><MessageCircle size={18} /></div><div><h3>Community feedback</h3><p>Follow development, report bugs, and suggest roadmap ideas.</p>{MIXARR_BETA_DISCORD_URL ? <a href={MIXARR_BETA_DISCORD_URL} target="_blank" rel="noopener noreferrer">Open Discord</a> : <Link href="/support">Open Beta Support</Link>}</div></article>
        <article className={styles.callout}><div className={styles.calloutIcon}><HeartHandshake size={18} /></div><div><h3>Safe beta defaults</h3><p>Beta builds prioritize explicit opt-in, local storage, explainable behavior, and graceful fallbacks.</p></div></article>
      </section>
      <div className={styles.footerActions}><Link href="/release-notes" className={styles.secondaryButton}><FlaskConical size={16} /> Release Notes</Link><Link href="/" className={styles.primaryButton}>Back to Dashboard</Link></div>
    </main>
  );
}
