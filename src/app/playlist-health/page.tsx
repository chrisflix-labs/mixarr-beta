import { cookies } from "next/headers";
import Link from "next/link";
import { HeartPulse } from "lucide-react";
import PlaylistHealthMonitor from "@/components/PlaylistHealthMonitor";
import styles from "./playlist-health.module.css";

export default function PlaylistHealthPage({ searchParams }: { searchParams?: { playlistId?: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return <main className={styles.workspace}><section className={styles.empty}><HeartPulse size={38} /><h1>Playlist Health</h1><p>Connect Plex to monitor playlist quality and playback readiness.</p><Link href="/">Return to dashboard</Link></section></main>;
  return <PlaylistHealthMonitor initialPlaylistId={searchParams?.playlistId} />;
}
