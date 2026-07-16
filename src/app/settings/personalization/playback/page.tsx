import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Headphones } from "lucide-react";
import PlaybackAwarenessPanel from "@/components/PlaybackAwarenessPanel";
import { getPlaybackDashboardSummary, getPlaybackSyncStatus, listPlexPlaybackUsers } from "@/lib/playbackAwareness";
import styles from "./playback.module.css";

export const metadata: Metadata = {
  title: "Playback Awareness | Mixarr",
  description: "Configure private, per-user Plex playback-aware Smart Mix recommendations.",
};

export default async function PlaybackAwarenessPage() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return <main className={styles.page}><p>Connect Plex to configure playback awareness.</p></main>;
  const [summary, users, states] = await Promise.all([
    getPlaybackDashboardSummary(userId),
    listPlexPlaybackUsers(userId),
    getPlaybackSyncStatus(userId),
  ]);
  return <main className={styles.page}><header><h2><Headphones size={28} color="var(--accent)" /> Playback Awareness</h2><p>Use locally stored Plex listening history as a transparent, confidence-limited Smart Mix layer.</p></header><PlaybackAwarenessPanel initialSummary={summary} initialUsers={users} initialStates={states} /></main>;
}
