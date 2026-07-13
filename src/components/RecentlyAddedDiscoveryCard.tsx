"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock3, Music2, Sparkles } from "lucide-react";
import styles from "@/app/page.module.css";

export default function RecentlyAddedDiscoveryCard() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { fetch("/api/recently-added/summary", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then(setData).catch(() => undefined); }, []);
  const counts = data?.counts || {};
  return (
    <article className={`${styles.card} ${styles.recentlyAddedCard}`}>
      <div className={styles.recentlyAddedTop}><Sparkles size={22} className={styles.cardIcon} /><span data-enabled={data?.settings?.enabled}>{data?.settings?.enabled ? "Enabled" : "Disabled"}</span></div>
      <h3>Recently Added Discovery</h3>
      {!data?.settings?.enabled && <p>Automation is disabled. Mixarr can still scan new music and suggest compatible playlist additions without making changes automatically.</p>}
      {data?.settings?.enabled && <p>New music is being watched using your saved automation and playlist-level safety settings.</p>}
      <div className={styles.recentlyAddedMetrics}>
        <span><b>{counts.newTracks || 0}</b> new tracks</span><span><b>{counts.strongMatches || 0}</b> strong matches</span>
        <span><b>{counts.suggestions || 0}</b> suggestions</span><span><b>{counts.waiting || 0}</b> waiting</span>
      </div>
      <small className={styles.cardDetailLine}><Clock3 size={12} /> {data?.lastScanAt ? `Last scan ${new Date(data.lastScanAt).toLocaleString()}` : "No scan yet"}</small>
      <div className={styles.versionCardActions}><Link href="/recently-added" className={styles.cardAction}><Music2 size={14} /> Review New Music</Link><Link href="/recently-added#automation-settings" className={`${styles.cardAction} ${styles.secondaryCardAction}`}>Configure</Link></div>
    </article>
  );
}

