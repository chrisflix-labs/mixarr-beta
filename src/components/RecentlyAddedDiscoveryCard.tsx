import Link from "next/link";
import { Clock3, Music2, Sparkles } from "lucide-react";
import styles from "@/app/page.module.css";
import type { getRecentlyAddedSummary } from "@/lib/recentlyAdded";

type Summary = Awaited<ReturnType<typeof getRecentlyAddedSummary>>;

export default function RecentlyAddedDiscoveryCard({ summary }: { summary: Summary | null }) {
  const enabled = !!summary?.settings.enabled;
  const counts = summary?.counts;
  return (
    <article className={`${styles.actionCard} ${styles.recentlyAddedCard}`}>
      <div className={styles.cardTopline}>
        <span className={styles.actionIcon}><Sparkles size={19} /></span>
        <span className={styles.statusBadge} data-status={enabled ? "ready" : "disabled"}>{enabled ? "Enabled" : "Disabled"}</span>
      </div>
      <h3>Recently Added Discovery</h3>
      {!summary ? (
        <p>Recently Added status is unavailable. Review new music or open configuration to continue.</p>
      ) : enabled ? (
        <p>Review new music and compatible playlist suggestions from the latest scan.</p>
      ) : (
        <p>Mixarr can still scan new music without applying automatic changes.</p>
      )}
      {enabled && counts && (
        <div className={styles.miniMetrics}>
          <span><b>{counts.newTracks}</b>New tracks</span>
          <span><b>{counts.strongMatches}</b>Strong matches</span>
          <span><b>{counts.suggestions}</b>Suggestions</span>
          <span><b>{counts.waiting}</b>Pending</span>
        </div>
      )}
      <small className={styles.cardMeta}><Clock3 size={12} /> {summary?.lastScanAt ? `Last scan ${new Date(summary.lastScanAt).toLocaleString()}` : "No scan yet"}</small>
      <div className={styles.cardActions}>
        <Link href="/recently-added" className={styles.primaryAction}><Music2 size={14} /> Review New Music</Link>
        <Link href="/recently-added#automation-settings" className={styles.secondaryAction}>{enabled ? "Configure" : "Enable Automation"}</Link>
      </div>
    </article>
  );
}
