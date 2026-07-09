"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { AlertTriangle, Clock3, History, ListFilter, RefreshCw, Search } from "lucide-react";
import styles from "./playlist-history.module.css";

type PlaylistHistoryEntry = {
  id: string;
  generatedPlaylistId?: string | null;
  playlistName: string;
  eventType: string;
  sourceType: string;
  engineVersion?: "v1" | "v2" | null;
  recipeName?: string | null;
  smartPresetName?: string | null;
  moodPresetName?: string | null;
  bpmPresetName?: string | null;
  regenerationMode?: string | null;
  keepPercent?: number | null;
  trackCount: number;
  previousTrackCount?: number | null;
  keptCount?: number | null;
  replacedCount?: number | null;
  newCount?: number | null;
  removedCount?: number | null;
  manualExclusionsRemoved: number;
  safetyRulesApplied: boolean;
  safetyRulesRemoved: number;
  summary?: string | null;
  createdAt: string;
  _count?: { tracks: number };
};

const eventTypeOptions = [
  ["all", "All"],
  ["created", "Created"],
  ["regenerated", "Regenerated"],
  ["created_copy", "Created Copy"],
  ["removed_tracking", "Removed Tracking"],
];

const sourceTypeOptions = [
  ["all", "All"],
  ["manual_builder", "Standard Builder"],
  ["smart_builder", "Smart Builder"],
  ["recipe", "Recipe"],
  ["regeneration", "Regeneration"],
];

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

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function regenerationModeLabel(entry: PlaylistHistoryEntry) {
  if (entry.regenerationMode === "keep_some") return `Keep ${entry.keepPercent || 0}%`;
  if (entry.regenerationMode === "replace_all") return "Replace All";
  return null;
}

export default function PlaylistHistoryPage() {
  const [generatedPlaylistId, setGeneratedPlaylistId] = useState("");
  const [history, setHistory] = useState<PlaylistHistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [eventType, setEventType] = useState("all");
  const [sourceType, setSourceType] = useState("all");
  const [playlistName, setPlaylistName] = useState("");
  const [recipeName, setRecipeName] = useState("");
  const [paramsReady, setParamsReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const activeFilterText = useMemo(() => {
    const parts = [
      generatedPlaylistId ? "generated playlist" : "",
      eventType !== "all" ? eventTypeLabel(eventType) : "",
      sourceType !== "all" ? sourceTypeLabel(sourceType) : "",
      playlistName ? `playlist "${playlistName}"` : "",
      recipeName ? `recipe "${recipeName}"` : "",
    ].filter(Boolean);
    return parts.length ? `Filtered by ${parts.join(", ")}` : "Showing newest playlist events";
  }, [eventType, generatedPlaylistId, playlistName, recipeName, sourceType]);

  const fetchHistory = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await axios.get("/api/playlist-history", {
        params: {
          eventType,
          sourceType,
          playlistName: playlistName || undefined,
          recipeName: recipeName || undefined,
          generatedPlaylistId: generatedPlaylistId || undefined,
          limit: 50,
        },
      });
      setHistory(res.data.history || []);
      setTotal(res.data.total || 0);
    } catch (requestError) {
      console.error(requestError);
      setError("Unable to load playlist history.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setGeneratedPlaylistId(params.get("generatedPlaylistId") || "");
    setEventType(params.get("eventType") || "all");
    setSourceType(params.get("sourceType") || "all");
    setPlaylistName(params.get("playlistName") || "");
    setRecipeName(params.get("recipeName") || "");
    setParamsReady(true);
  }, []);

  useEffect(() => {
    if (paramsReady) fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatedPlaylistId, paramsReady]);

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    fetchHistory();
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>
            <History size={14} />
            Playlist Timeline
          </span>
          <h2>Playlist History</h2>
          <p>Review created and regenerated playlists, including filters, presets, exclusions, safety rules, and track snapshots.</p>
        </div>
        <Link href="/generated-playlists" className={styles.secondaryButton}>
          Generated Playlists
        </Link>
      </header>

      <form className={styles.filters} onSubmit={applyFilters}>
        <div className={styles.filterField}>
          <label htmlFor="eventType">Event type</label>
          <select id="eventType" value={eventType} onChange={(event) => setEventType(event.target.value)}>
            {eventTypeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className={styles.filterField}>
          <label htmlFor="sourceType">Source</label>
          <select id="sourceType" value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
            {sourceTypeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className={styles.filterField}>
          <label htmlFor="playlistName">Playlist name</label>
          <input id="playlistName" value={playlistName} onChange={(event) => setPlaylistName(event.target.value)} placeholder="Search playlists" />
        </div>
        <div className={styles.filterField}>
          <label htmlFor="recipeName">Recipe name</label>
          <input id="recipeName" value={recipeName} onChange={(event) => setRecipeName(event.target.value)} placeholder="Search recipes" />
        </div>
        <button type="submit" className={styles.primaryButton}>
          <Search size={15} />
          Apply
        </button>
        <Link href="/playlist-history" className={styles.secondaryButton}>
          <ListFilter size={15} />
          Reset
        </Link>
      </form>

      <div className={styles.resultSummary}>
        <span>{activeFilterText}</span>
        <strong>{total.toLocaleString()} event{total === 1 ? "" : "s"}</strong>
      </div>

      {error && (
        <div className={styles.errorNotice}>
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {loading ? (
        <div className={styles.statePanel}>
          <RefreshCw size={18} className="animate-spin" />
          Loading playlist history...
        </div>
      ) : history.length === 0 ? (
        <section className={styles.emptyState}>
          <Clock3 size={30} />
          <h3>No playlist history yet.</h3>
          <p>Create or regenerate a Mixarr playlist to start building a timeline.</p>
          <div>
            <Link href="/builder" className={styles.primaryButton}>Open Builder</Link>
            <Link href="/smart-builder" className={styles.secondaryButton}>Open Smart Builder</Link>
          </div>
        </section>
      ) : (
        <section className={styles.timeline} aria-label="Playlist history events">
          {history.map((entry) => {
            const modeLabel = regenerationModeLabel(entry);
            const presets = [
              engineLabel(entry.engineVersion),
              entry.recipeName ? `Recipe: ${entry.recipeName}` : "",
              entry.smartPresetName ? `Smart: ${entry.smartPresetName}` : "",
              entry.moodPresetName ? `Mood: ${entry.moodPresetName}` : "",
              entry.bpmPresetName ? `BPM: ${entry.bpmPresetName}` : "",
              modeLabel ? `Mode: ${modeLabel}` : "",
            ].filter(Boolean);

            return (
              <article key={entry.id} className={styles.historyCard}>
                <div className={styles.historyTop}>
                  <div>
                    <span className={styles.eventBadge} data-event={entry.eventType}>{eventTypeLabel(entry.eventType)}</span>
                    <h3>{entry.playlistName}</h3>
                  </div>
                  <time>{formatDate(entry.createdAt)}</time>
                </div>
                <div className={styles.metaRow}>
                  <span>{sourceTypeLabel(entry.sourceType)}</span>
                  <span>{entry.trackCount.toLocaleString()} tracks</span>
                  <span>{(entry._count?.tracks || 0).toLocaleString()} snapshot tracks</span>
                </div>
                {presets.length > 0 && (
                  <div className={styles.badgeRow}>
                    {presets.map((preset) => <span key={preset}>{preset}</span>)}
                  </div>
                )}
                <p className={styles.summary}>{entry.summary || `${eventTypeLabel(entry.eventType)} "${entry.playlistName}" with ${entry.trackCount} tracks.`}</p>
                {entry.eventType === "regenerated" && (
                  <div className={styles.comparisonRow}>
                    <span>Previous {entry.previousTrackCount ?? "N/A"}</span>
                    <span>Kept {entry.keptCount ?? "N/A"}</span>
                    <span>Replaced {entry.replacedCount ?? "N/A"}</span>
                    <span>New {entry.newCount ?? "N/A"}</span>
                    <span>Removed {entry.removedCount ?? "N/A"}</span>
                  </div>
                )}
                <div className={styles.cardActions}>
                  <Link href={`/playlist-history/${entry.id}`} className={styles.primaryButton}>View Details</Link>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
