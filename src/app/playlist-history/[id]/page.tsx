import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, History, ShieldCheck } from "lucide-react";
import { getPlaylistHistoryEntry } from "@/lib/playlistHistory";
import styles from "../playlist-history.module.css";

export const metadata = {
  title: "Playlist History Details | Mixarr",
  description: "Playlist creation and regeneration history details",
};

function eventTypeLabel(eventType: string) {
  if (eventType === "created") return "Created";
  if (eventType === "regenerated") return "Regenerated";
  if (eventType === "created_copy") return "Created Copy";
  if (eventType === "removed_tracking") return "Removed Tracking";
  if (eventType === "deleted_plex_playlist") return "Deleted Plex Playlist";
  return "Unknown";
}

function sourceTypeLabel(sourceType: string) {
  if (sourceType === "manual_builder") return "Standard Builder";
  if (sourceType === "smart_builder") return "Smart Builder";
  if (sourceType === "recipe") return "Recipe";
  if (sourceType === "regeneration") return "Regeneration";
  return "Unknown";
}

function engineLabel(engineVersion?: string | null) {
  return engineVersion === "v2" ? "Smart Mix Engine: v2 Foundation" : "Smart Mix Engine: v1 Legacy";
}

function formatDate(value: Date) {
  return value.toLocaleString();
}

function formatDuration(ms?: number | null) {
  if (!ms) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatNumber(value?: number | null, digits = 0) {
  if (value == null) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function JsonBlock({ value, emptyLabel }: { value: unknown; emptyLabel: string }) {
  if (value == null) return <div className={styles.detailEmpty}>{emptyLabel}</div>;
  return <pre className={styles.jsonBlock}>{JSON.stringify(value, null, 2)}</pre>;
}

type HistoryTrackRow = {
  id: string;
  position: number;
  title: string;
  artist?: string | null;
  album?: string | null;
  duration?: number | null;
  bpm?: number | null;
  energy?: number | null;
  mood?: number | null;
  popularity?: number | null;
};

export default async function PlaylistHistoryDetailPage({ params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return (
      <main className={styles.page}>
        <div className={styles.emptyState}>Connect Plex to view playlist history.</div>
      </main>
    );
  }

  const entry = await getPlaylistHistoryEntry(userId, params.id);
  if (!entry) notFound();

  const warnings = Array.isArray(entry.warningsJson) ? entry.warningsJson as string[] : [];
  const tracks = entry.tracks as HistoryTrackRow[];
  const hasComparison = entry.previousTrackCount != null
    || entry.keptCount != null
    || entry.replacedCount != null
    || entry.newCount != null
    || entry.removedCount != null;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>
            <History size={14} />
            Playlist History
          </span>
          <h2>{entry.playlistName}</h2>
          <p>{entry.summary || `${eventTypeLabel(entry.eventType)} "${entry.playlistName}" with ${entry.trackCount} tracks.`}</p>
        </div>
        <Link href="/playlist-history" className={styles.secondaryButton}>
          <ArrowLeft size={15} />
          Back
        </Link>
      </header>

      <section className={styles.detailGrid}>
        <div className={styles.detailPanel}>
          <span className={styles.eventBadge} data-event={entry.eventType}>{eventTypeLabel(entry.eventType)}</span>
          <dl className={styles.detailStats}>
            <div><dt>Date</dt><dd>{formatDate(entry.createdAt)}</dd></div>
            <div><dt>Source</dt><dd>{sourceTypeLabel(entry.sourceType)}</dd></div>
            <div><dt>Engine</dt><dd>{engineLabel(entry.engineVersion)}</dd></div>
            <div><dt>Track count</dt><dd>{entry.trackCount.toLocaleString()}</dd></div>
            <div><dt>Plex rating key</dt><dd>{entry.plexPlaylistRatingKey || "—"}</dd></div>
            <div><dt>Recipe</dt><dd>{entry.recipeName || "—"}</dd></div>
            <div><dt>Smart preset</dt><dd>{entry.smartPresetName || "—"}</dd></div>
            <div><dt>Mood preset</dt><dd>{entry.moodPresetName || "—"}</dd></div>
            <div><dt>BPM preset</dt><dd>{entry.bpmPresetName || "—"}</dd></div>
          </dl>
        </div>

        <div className={styles.detailPanel}>
          <span className={styles.panelTitle}>
            <ShieldCheck size={15} />
            Safety and Exclusions
          </span>
          <dl className={styles.detailStats}>
            <div><dt>Manual exclusions removed</dt><dd>{entry.manualExclusionsRemoved.toLocaleString()}</dd></div>
            <div><dt>Safety rules applied</dt><dd>{entry.safetyRulesApplied ? "Yes" : "No"}</dd></div>
            <div><dt>Safety rules removed</dt><dd>{entry.safetyRulesRemoved.toLocaleString()}</dd></div>
            <div><dt>Server</dt><dd>{entry.server?.name || "—"}</dd></div>
          </dl>
        </div>
      </section>

      {entry.eventType === "regenerated" && (
        <section className={styles.detailPanel}>
          <span className={styles.panelTitle}>Regeneration Comparison</span>
          {hasComparison ? (
            <div className={styles.comparisonGrid}>
              <div><span>Previous count</span><strong>{formatNumber(entry.previousTrackCount)}</strong></div>
              <div><span>New count</span><strong>{formatNumber(entry.trackCount)}</strong></div>
              <div><span>Kept</span><strong>{formatNumber(entry.keptCount)}</strong></div>
              <div><span>Replaced</span><strong>{formatNumber(entry.replacedCount)}</strong></div>
              <div><span>New tracks</span><strong>{formatNumber(entry.newCount)}</strong></div>
              <div><span>Removed tracks</span><strong>{formatNumber(entry.removedCount)}</strong></div>
              <div><span>Manual exclusions removed</span><strong>{entry.manualExclusionsRemoved.toLocaleString()}</strong></div>
              <div><span>Safety rules removed</span><strong>{entry.safetyRulesRemoved.toLocaleString()}</strong></div>
            </div>
          ) : (
            <div className={styles.detailEmpty}>Detailed comparison data was not available for this history entry.</div>
          )}
        </section>
      )}

      <section className={styles.detailPanel}>
        <span className={styles.panelTitle}>Warnings</span>
        {warnings.length > 0 ? (
          <div className={styles.warningList}>
            {warnings.map((warning) => (
              <p key={warning}>
                <AlertTriangle size={15} />
                {warning}
              </p>
            ))}
          </div>
        ) : (
          <div className={styles.detailEmpty}>No warnings were recorded for this event.</div>
        )}
      </section>

      <section className={styles.detailColumns}>
        <div className={styles.detailPanel}>
          <span className={styles.panelTitle}>Filters Used</span>
          <JsonBlock value={entry.filtersJson} emptyLabel="No filters were recorded for this event." />
        </div>
        <div className={styles.detailPanel}>
          <span className={styles.panelTitle}>Safety Rules Used</span>
          <JsonBlock value={entry.safetyRulesJson} emptyLabel="No safety rules were recorded for this event." />
        </div>
      </section>

      <section className={styles.detailPanel}>
        <span className={styles.panelTitle}>Track Order Written to Plex</span>
        {tracks.length === 0 ? (
          <div className={styles.detailEmpty}>No track snapshot was recorded for this event.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.trackTable}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Track title</th>
                  <th>Artist</th>
                  <th>Album</th>
                  <th>Duration</th>
                  <th>BPM</th>
                  <th>Energy</th>
                  <th>Mood</th>
                  <th>Popularity</th>
                </tr>
              </thead>
              <tbody>
                {tracks.map((track) => (
                  <tr key={track.id}>
                    <td>{track.position}</td>
                    <td>{track.title || "—"}</td>
                    <td>{track.artist || "—"}</td>
                    <td>{track.album || "—"}</td>
                    <td>{formatDuration(track.duration)}</td>
                    <td>{formatNumber(track.bpm)}</td>
                    <td>{formatNumber(track.energy, 2)}</td>
                    <td>{formatNumber(track.mood, 2)}</td>
                    <td>{formatNumber(track.popularity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
