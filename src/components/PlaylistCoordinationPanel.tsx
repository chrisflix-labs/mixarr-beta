import Link from "next/link";
import { CheckCircle2, Network } from "lucide-react";
import styles from "./PlaylistCoordinationPanel.module.css";

export default function PlaylistCoordinationPanel({ playlist }: { playlist: any }) {
  const relationships = [...(playlist.relationshipSources || []), ...(playlist.relationshipTargets || [])];
  const settings = playlist.coordinationSettings || { coordinationEnabled: false, maximumSharedTrackPercentage: 20, overlapEnforcement: "SOFT_TARGET", keepDistinct: false, allowSharedCoreTracks: false };
  const overlaps = [...(playlist.overlapSummariesA || []), ...(playlist.overlapSummariesB || [])];
  const highestOverlap = Math.max(0, ...overlaps.map((overlap: any) => overlap.sharedTrackPercentage));
  return <section className={styles.panel} aria-label="Playlist coordination">
    <div className={styles.header}><span><Network size={15} /> Playlist Coordination</span><Link href="/playlist-coordination">Manage</Link></div>
    {!relationships.length ? <p className={styles.empty}>No relationships yet. This playlist remains independent.</p> : <>
      <div className={styles.stats}><div><span>Relationships</span><strong>{relationships.length}</strong></div><div><span>Highest overlap</span><strong>{highestOverlap}%</strong></div><div><span>Limit</span><strong>{settings.maximumSharedTrackPercentage}%</strong></div><div><span>Status</span><strong>{settings.coordinationEnabled ? <><CheckCircle2 size={12} /> Enabled</> : "Disabled"}</strong></div></div>
      <p>{relationships.map((relationship: any) => relationship.sourcePlaylistId === playlist.id ? relationship.targetPlaylist.plexPlaylistTitle : relationship.sourcePlaylist.plexPlaylistTitle).join(" · ")}</p>
      <small>{settings.overlapEnforcement.replaceAll("_", " ")} · {settings.keepDistinct ? "keep distinct" : "track overlap only"} · {settings.allowSharedCoreTracks ? "shared core allowed" : "no shared core"}</small>
    </>}
  </section>;
}
