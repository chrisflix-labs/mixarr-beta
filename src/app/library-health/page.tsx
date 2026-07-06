"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, HeartPulse, Loader2, RefreshCw, Settings, X } from "lucide-react";
import styles from "./library-health.module.css";

type Category =
  | "all_tracks"
  | "missing_bpm"
  | "api_bpm"
  | "local_bpm"
  | "missing_audio_features"
  | "partial_audio_features"
  | "pending_audio_features"
  | "complete_audio_features"
  | "failed_analysis"
  | "failed_bpm_analysis"
  | "failed_audio_feature_analysis"
  | "missing_local_file"
  | "too_short"
  | "skipped"
  | "healthy_tracks";

type LibraryOption = { id: string; name: string; server: { id: string; name: string } };
type Summary = { totalTracks: number; categories: Record<Category, number>; libraries: LibraryOption[] };
type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  library: { id: string; name: string };
  ratingKey: string;
  duration: number | null;
  mediaPath: string | null;
  bpm: number | null;
  bpmSource: string | null;
  energy: number | null;
  mood: number | null;
  danceability: number | null;
  audioFeatureStatus: string;
  localFileStatus: string;
  lastAnalyzed: string | null;
  failureReason: string | null;
  reason: string;
};

const categoryLabels: Record<Category, string> = {
  all_tracks: "All Tracks",
  missing_bpm: "Missing BPM",
  api_bpm: "API BPM Only",
  local_bpm: "Local BPM Available",
  missing_audio_features: "Missing Audio Features",
  partial_audio_features: "Partial Audio Features",
  pending_audio_features: "Pending Audio Features",
  complete_audio_features: "Complete Audio Features",
  failed_analysis: "Failed Analysis",
  failed_bpm_analysis: "Failed BPM Analysis",
  failed_audio_feature_analysis: "Failed Audio Feature Analysis",
  missing_local_file: "Missing Local File",
  too_short: "Too Short To Analyze",
  skipped: "Skipped",
  healthy_tracks: "Healthy Tracks",
};

const emptyMessages: Record<Category, string> = {
  all_tracks: "No active tracks found.",
  missing_bpm: "No tracks are missing BPM. Nice!",
  api_bpm: "No tracks are relying on API-only BPM.",
  local_bpm: "No tracks have locally analyzed BPM yet.",
  missing_audio_features: "No tracks are missing required audio features for the current provider mode.",
  partial_audio_features: "No tracks have partial audio feature data.",
  pending_audio_features: "No tracks are pending audio feature analysis.",
  complete_audio_features: "No tracks have complete audio features yet.",
  failed_analysis: "No failed analysis jobs found.",
  failed_bpm_analysis: "No failed BPM analysis jobs found.",
  failed_audio_feature_analysis: "No failed audio feature analysis jobs found.",
  missing_local_file: "No tracks are missing local files.",
  too_short: "No tracks are too short to analyze.",
  skipped: "No skipped analysis tracks found.",
  healthy_tracks: "No fully healthy tracks found yet.",
};

const categoryOrder: Category[] = [
  "all_tracks",
  "missing_bpm",
  "api_bpm",
  "missing_audio_features",
  "partial_audio_features",
  "pending_audio_features",
  "failed_analysis",
  "failed_bpm_analysis",
  "failed_audio_feature_analysis",
  "missing_local_file",
  "too_short",
  "skipped",
  "local_bpm",
  "complete_audio_features",
  "healthy_tracks",
];

const actionableCategories: Category[] = [
  "missing_bpm",
  "api_bpm",
  "missing_audio_features",
  "partial_audio_features",
  "pending_audio_features",
  "failed_bpm_analysis",
  "failed_audio_feature_analysis",
  "too_short",
  "skipped",
];

const defaultFilters = {
  libraryId: "",
  search: "",
  artist: "",
  album: "",
  bpmSource: "all",
  audioFeatureStatus: "all",
  localFileStatus: "all",
  failedOnly: false,
  missingDataOnly: false,
  sort: "",
  direction: "desc",
};

function isCategory(value: string | null): value is Category {
  return !!value && Object.prototype.hasOwnProperty.call(categoryLabels, value);
}

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat().format(value || 0);
}

function formatDuration(value: number | null) {
  if (!value) return "-";
  const seconds = Math.round(value / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatDecimal(value: number | null) {
  return value === null ? "-" : value.toFixed(2);
}

function retryTypeFor(category: Category): "bpm" | "audio_features" {
  return category === "missing_audio_features" || category === "partial_audio_features" || category === "pending_audio_features" || category === "failed_audio_feature_analysis"
    ? "audio_features"
    : "bpm";
}

export default function LibraryHealthDetailsPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [category, setCategory] = useState<Category>("missing_bpm");
  const [filters, setFilters] = useState(defaultFilters);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedCount = selected.size;
  const allVisibleSelected = tracks.length > 0 && tracks.every((track) => selected.has(track.id));

  const buildParams = useCallback((requestedPage: number, requestedCategory = category) => {
    const params = new URLSearchParams({ filter: requestedCategory, page: String(requestedPage), pageSize: "50" });
    Object.entries(filters).forEach(([key, value]) => {
      if (typeof value === "boolean") {
        if (value) params.set(key, "true");
      } else if (value && value !== "all") {
        params.set(key, value);
      }
    });
    return params;
  }, [category, filters]);

  const syncUrl = useCallback((requestedCategory: Category, requestedPage: number) => {
    const params = buildParams(requestedPage, requestedCategory);
    const visible = new URLSearchParams(params);
    if (requestedPage <= 1) visible.delete("page");
    window.history.replaceState({}, "", `/library-health?${visible.toString()}`);
  }, [buildParams]);

  const loadSummary = useCallback(async (libraryId = filters.libraryId) => {
    const params = new URLSearchParams();
    if (libraryId) params.set("libraryId", libraryId);
    const response = await fetch(`/api/library-health/summary?${params}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load Library Health details. Check logs or try again.");
    setSummary(data);
  }, [filters.libraryId]);

  const loadTracks = useCallback(async (requestedCategory = category, requestedPage = page) => {
    setTracksLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/library-health/tracks?${buildParams(requestedPage, requestedCategory)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load Library Health details. Check logs or try again.");
      setTracks(data.tracks || []);
      setPagination({ page: data.page, pageSize: data.pageSize, total: data.total, totalPages: data.totalPages });
      setSelected(new Set());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load Library Health details. Check logs or try again.");
    } finally {
      setTracksLoading(false);
    }
  }, [buildParams, category, page]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextCategory = isCategory(params.get("filter") || params.get("category")) ? (params.get("filter") || params.get("category")) as Category : "missing_bpm";
    const nextFilters = {
      ...defaultFilters,
      libraryId: params.get("libraryId") || "",
      search: params.get("search") || "",
      artist: params.get("artist") || "",
      album: params.get("album") || "",
      bpmSource: params.get("bpmSource") || "all",
      audioFeatureStatus: params.get("audioFeatureStatus") || "all",
      localFileStatus: params.get("localFileStatus") || "all",
      failedOnly: params.get("failedOnly") === "true",
      missingDataOnly: params.get("missingDataOnly") === "true",
      sort: params.get("sort") || "",
      direction: params.get("direction") || "desc",
    };
    const initialPage = Math.max(1, Number(params.get("page")) || 1);
    setCategory(nextCategory);
    setFilters(nextFilters);
    setPage(initialPage);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (loading) return;
    void loadSummary().catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load Library Health details. Check logs or try again."));
    void loadTracks(category, page);
  }, [loading, category, page, loadSummary, loadTracks]);

  const cards = useMemo(() => {
    const counts = summary?.categories;
    return [
      { key: "total", label: "Total Tracks", count: summary?.totalTracks || 0, category: "all_tracks" as Category },
      { key: "healthy", label: "Healthy Tracks", count: counts?.healthy_tracks || 0, category: "healthy_tracks" as Category },
      { key: "missing_bpm", label: "Missing BPM", count: counts?.missing_bpm || 0, category: "missing_bpm" as Category },
      { key: "api_bpm", label: "API BPM Only", count: counts?.api_bpm || 0, category: "api_bpm" as Category },
      { key: "missing_audio_features", label: "Missing Audio Features", count: counts?.missing_audio_features || 0, category: "missing_audio_features" as Category },
      { key: "partial_audio_features", label: "Partial Audio Features", count: counts?.partial_audio_features || 0, category: "partial_audio_features" as Category },
      { key: "pending_audio_features", label: "Pending Audio Features", count: counts?.pending_audio_features || 0, category: "pending_audio_features" as Category },
      { key: "failed", label: "Failed Analysis", count: counts?.failed_analysis || 0, category: "failed_analysis" as Category },
      { key: "missing_local_file", label: "Missing Local Files", count: counts?.missing_local_file || 0, category: "missing_local_file" as Category },
    ];
  }, [summary]);

  function updateCategory(nextCategory: Category) {
    setCategory(nextCategory);
    setPage(1);
    setMessage(null);
    syncUrl(nextCategory, 1);
  }

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setMessage(null);
    syncUrl(category, 1);
    void loadSummary();
    void loadTracks(category, 1);
  }

  async function retryTracks(trackIds?: string[]) {
    setWorking(trackIds?.length ? "selected" : "filter");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/library-health/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          retryType: retryTypeFor(category),
          libraryId: filters.libraryId || undefined,
          trackIds,
          providerMode: "configured",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to queue Library Health retry");
      setMessage(data.summary || data.message || `Queued ${data.queued || 0} tracks.`);
      await Promise.all([loadSummary(), loadTracks(category, page)]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to queue Library Health retry");
    } finally {
      setWorking(null);
    }
  }

  const canRetry = actionableCategories.includes(category);

  if (loading) {
    return <main className={styles.page}><div className={`glass-panel ${styles.loading}`}><Loader2 className="animate-spin" size={18} /> Loading Library Health details...</div></main>;
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h2><HeartPulse size={24} /> Library Health Details</h2>
          <p>Inspect affected tracks, reasons, status fields, and retry options.</p>
        </div>
        <Link href="/settings/library-health" className={styles.settingsLink}><Settings size={15} /> Maintenance Tools</Link>
      </header>

      {summary && summary.totalTracks === 0 && (
        <div className={`glass-panel ${styles.empty}`}>Library Health data is not available yet. Run a library sync or audio analysis job first.</div>
      )}

      <section className={styles.summaryGrid} aria-label="Library Health summary">
        {cards.map((card) => (
          <button key={card.key} className={`${styles.summaryCard} ${category === card.category ? styles.summaryCardActive : ""}`} type="button" onClick={() => updateCategory(card.category)}>
            <span>{card.label}</span>
            <strong>{formatNumber(card.count)}</strong>
            <small>{card.key === "total" ? "Active library tracks" : "Open filtered track list"}</small>
          </button>
        ))}
      </section>

      {message && <div className={styles.message}>{message}</div>}
      {error && <div className={styles.error}>{error}</div>}

      <section className={`glass-panel ${styles.panel}`}>
        <form className={styles.toolbar} onSubmit={applyFilters}>
          <label>
            <span>Health category</span>
            <select value={category} onChange={(event) => updateCategory(event.target.value as Category)}>
              {categoryOrder.map((item) => <option key={item} value={item}>{categoryLabels[item]}</option>)}
            </select>
          </label>
          <label>
            <span>Library</span>
            <select value={filters.libraryId} onChange={(event) => setFilters({ ...filters, libraryId: event.target.value })}>
              <option value="">All libraries</option>
              {(summary?.libraries || []).map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}
            </select>
          </label>
          <label className={styles.searchField}>
            <span>Search title, artist, album, or path</span>
            <input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Search tracks" />
          </label>
          <label>
            <span>Artist</span>
            <input value={filters.artist} onChange={(event) => setFilters({ ...filters, artist: event.target.value })} />
          </label>
          <label>
            <span>Album</span>
            <input value={filters.album} onChange={(event) => setFilters({ ...filters, album: event.target.value })} />
          </label>
          <label>
            <span>BPM source</span>
            <select value={filters.bpmSource} onChange={(event) => setFilters({ ...filters, bpmSource: event.target.value })}>
              <option value="all">All</option>
              <option value="missing">Missing</option>
              <option value="api">API</option>
              <option value="local">Local</option>
              <option value="imported">Imported</option>
            </select>
          </label>
          <label>
            <span>Audio feature status</span>
            <select value={filters.audioFeatureStatus} onChange={(event) => setFilters({ ...filters, audioFeatureStatus: event.target.value })}>
              <option value="all">All</option>
              <option value="missing">Missing</option>
              <option value="partial">Partial</option>
              <option value="success">Success</option>
              <option value="no_data">No data</option>
              <option value="extraction_failed">Extraction failed</option>
              <option value="analyzer_failed">Analyzer failed</option>
              <option value="too_short">Too short</option>
            </select>
          </label>
          <label>
            <span>Local file status</span>
            <select value={filters.localFileStatus} onChange={(event) => setFilters({ ...filters, localFileStatus: event.target.value })}>
              <option value="all">All</option>
              <option value="available">Available</option>
              <option value="missing">Missing</option>
            </select>
          </label>
          <label>
            <span>Sort by</span>
            <select value={filters.sort} onChange={(event) => setFilters({ ...filters, sort: event.target.value })}>
              <option value="">Default</option>
              <option value="artist">Artist</option>
              <option value="title">Track title</option>
              <option value="album">Album</option>
              <option value="duration">Duration</option>
              <option value="bpm">BPM</option>
              <option value="lastAnalyzed">Last analyzed</option>
              <option value="failureStatus">Failure status</option>
            </select>
          </label>
          <label>
            <span>Direction</span>
            <select value={filters.direction} onChange={(event) => setFilters({ ...filters, direction: event.target.value })}>
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </label>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={filters.failedOnly} onChange={(event) => setFilters({ ...filters, failedOnly: event.target.checked })} />
            Failed only
          </label>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={filters.missingDataOnly} onChange={(event) => setFilters({ ...filters, missingDataOnly: event.target.checked })} />
            Missing data only
          </label>
          <div className={styles.buttonGroup}>
            <button className={styles.primaryButton} type="submit">Apply</button>
            <button className={styles.secondaryButton} type="button" onClick={() => {
              setFilters(defaultFilters);
              setPage(1);
              window.history.replaceState({}, "", `/library-health?filter=${category}`);
              void loadSummary("");
              void loadTracks(category, 1);
            }}><X size={14} /> Clear</button>
          </div>
        </form>
      </section>

      <section className={`glass-panel ${styles.panel}`}>
        <div className={styles.tableTop}>
          <div>
            <h3>{categoryLabels[category]}</h3>
            <p className={styles.muted}>{formatNumber(pagination.total)} matching track{pagination.total === 1 ? "" : "s"}</p>
          </div>
          <div className={styles.buttonGroup}>
            <button className={styles.secondaryButton} disabled={!tracks.length} onClick={() => setSelected(allVisibleSelected ? new Set() : new Set(tracks.map((track) => track.id)))}>Select all visible</button>
            <button className={styles.secondaryButton} disabled={!selectedCount} onClick={() => setSelected(new Set())}>Clear selection</button>
            {canRetry && <button className={styles.secondaryButton} disabled={!selectedCount || working !== null} onClick={() => void retryTracks(Array.from(selected))}><RefreshCw size={15} /> Retry selected ({selectedCount})</button>}
            {canRetry && <button className={styles.primaryButton} disabled={working !== null || pagination.total === 0} onClick={() => void retryTracks()}>{working === "filter" ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />} Retry all tracks matching this filter</button>}
          </div>
        </div>

        {tracksLoading ? (
          <div className={styles.loading}><Loader2 className="animate-spin" size={18} /> Loading tracks...</div>
        ) : tracks.length === 0 ? (
          <div className={styles.empty}>{filters.search || filters.artist || filters.album ? "No tracks match this Library Health filter." : emptyMessages[category]}</div>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th><input type="checkbox" aria-label="Select visible tracks" checked={allVisibleSelected} onChange={() => setSelected(allVisibleSelected ? new Set() : new Set(tracks.map((track) => track.id)))} /></th>
                  <th>Track</th>
                  <th>Artist</th>
                  <th>Album</th>
                  <th>BPM</th>
                  <th>BPM source</th>
                  <th>Energy</th>
                  <th>Mood</th>
                  <th>Danceability</th>
                  <th>Audio feature status</th>
                  <th>Local file</th>
                  <th>Last analyzed</th>
                  <th>Failure reason</th>
                  <th>Reason</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tracks.map((track) => (
                  <tr key={track.id}>
                    <td data-label=""><input type="checkbox" aria-label={`Select ${track.title}`} checked={selected.has(track.id)} onChange={() => setSelected((current) => { const next = new Set(current); next.has(track.id) ? next.delete(track.id) : next.add(track.id); return next; })} /></td>
                    <td data-label="Track" className={styles.trackCell}><strong>{track.title}</strong><small className={styles.trackMeta}>{track.library.name} | {formatDuration(track.duration)} | {track.ratingKey}</small></td>
                    <td data-label="Artist">{track.artist}</td>
                    <td data-label="Album">{track.album}</td>
                    <td data-label="BPM">{track.bpm === null ? "-" : Math.round(track.bpm * 10) / 10}</td>
                    <td data-label="BPM source">{track.bpmSource || "-"}</td>
                    <td data-label="Energy">{formatDecimal(track.energy)}</td>
                    <td data-label="Mood">{formatDecimal(track.mood)}</td>
                    <td data-label="Danceability">{formatDecimal(track.danceability)}</td>
                    <td data-label="Audio status"><span className={track.audioFeatureStatus === "complete" ? `${styles.badge} ${styles.okBadge}` : styles.badge}>{track.audioFeatureStatus}</span></td>
                    <td data-label="Local file"><span className={track.localFileStatus === "missing" ? `${styles.badge} ${styles.dangerBadge}` : `${styles.badge} ${styles.okBadge}`}>{track.localFileStatus}</span><small className={`${styles.trackMeta} ${styles.path}`} title={track.mediaPath || ""}>{track.mediaPath || "-"}</small></td>
                    <td data-label="Last analyzed">{formatDate(track.lastAnalyzed)}</td>
                    <td data-label="Failure reason">{track.failureReason || "-"}</td>
                    <td data-label="Reason" className={styles.reason}>{track.reason}</td>
                    <td data-label="Actions">{canRetry ? <button className={styles.tableAction} disabled={working !== null} onClick={() => void retryTracks([track.id])}>Retry</button> : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className={styles.pagination}>
          <span>Page {pagination.page} of {pagination.totalPages}</span>
          <div className={styles.buttonGroup}>
            <button aria-label="Previous page" disabled={page <= 1} onClick={() => { const next = page - 1; setPage(next); syncUrl(category, next); }}><ChevronLeft size={16} /></button>
            <button aria-label="Next page" disabled={page >= pagination.totalPages} onClick={() => { const next = page + 1; setPage(next); syncUrl(category, next); }}><ChevronRight size={16} /></button>
          </div>
        </div>
      </section>
    </main>
  );
}
