"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { AlertTriangle, Ban, CheckCircle2, History, ListRestart, RefreshCw, Repeat2, ShieldCheck, Trash2, Wand2 } from "lucide-react";
import TrackPreviewButton from "@/components/TrackPreviewButton";
import styles from "./generated-playlists.module.css";

type GeneratedPlaylist = {
  id: string;
  plexPlaylistRatingKey?: string | null;
  plexPlaylistTitle: string;
  sourceType: string;
  recipeName?: string | null;
  smartPresetName?: string | null;
  moodPresetName?: string | null;
  bpmPresetName?: string | null;
  trackCount: number;
  lastGeneratedAt: string;
  lastRegeneratedAt?: string | null;
  _count?: { tracks: number };
};

type PreviewState = {
  previewId: string;
  trackIds: string[];
  tracks: any[];
  warnings: string[];
  summary: {
    targetTrackCount: number;
    matchingTrackCount: number;
    finalTrackCount: number;
    manualExclusionsRemoved?: number;
    removedBySafetyRules?: number;
    safetyRuleSummary?: string;
  };
  regeneration: {
    mode: "replace_all" | "keep_some";
    currentPlaylistTrackCount: number;
    previousSnapshotTrackCount: number;
    newPreviewTrackCount: number;
    tracksKept: number;
    tracksReplaced: number;
    tracksReused: number;
    newTracks: number;
    newTracksAdded?: number;
    removedTracks: number;
    keepPercent?: number | null;
    previousTracksAvoided?: number;
    preferDifferentTracks?: boolean;
    manualExclusionsRemoved?: number;
    snapshotAvailable: boolean;
    recipeName?: string | null;
    smartPresetName?: string | null;
    moodPresetName?: string | null;
    bpmPresetName?: string | null;
  };
};

type RegenerationOptions = {
  mode: "replace_all" | "keep_some";
  keepPercent: 25 | 50;
  preferDifferentTracks: boolean;
};

const defaultRegenerationOptions: RegenerationOptions = {
  mode: "replace_all",
  keepPercent: 25,
  preferDifferentTracks: false,
};

function formatDate(value?: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function formatDuration(ms?: number | null) {
  if (!ms) return "-";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function sourceLabel(sourceType: string) {
  if (sourceType === "recipe") return "Recipe";
  if (sourceType === "smart_builder") return "Smart Builder";
  if (sourceType === "manual_builder") return "Builder";
  return "Unknown";
}

export default function GeneratedPlaylistsPage() {
  const [playlists, setPlaylists] = useState<GeneratedPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [optionsByPlaylist, setOptionsByPlaylist] = useState<Record<string, RegenerationOptions>>({});
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedPlaylist = useMemo(
    () => playlists.find((playlist) => playlist.id === selectedId) || null,
    [playlists, selectedId],
  );

  const fetchPlaylists = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await axios.get("/api/generated-playlists");
      setPlaylists(res.data.playlists || []);
    } catch (requestError) {
      console.error(requestError);
      setError("Unable to load generated playlists.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlaylists();
  }, []);

  const getRegenerationOptions = (playlistId: string) => optionsByPlaylist[playlistId] || defaultRegenerationOptions;

  const updateRegenerationOptions = (playlistId: string, nextOptions: Partial<RegenerationOptions>) => {
    setOptionsByPlaylist((current) => ({
      ...current,
      [playlistId]: {
        ...(current[playlistId] || defaultRegenerationOptions),
        ...nextOptions,
      },
    }));
    if (selectedId === playlistId) {
      setPreview(null);
    }
  };

  const previewRegeneration = async (playlist: GeneratedPlaylist) => {
    const options = getRegenerationOptions(playlist.id);
    setBusyId(playlist.id);
    setSelectedId(playlist.id);
    setPreview(null);
    setMessage("");
    setError("");
    try {
      const res = await axios.post(`/api/generated-playlists/${playlist.id}/preview-regeneration`, {
        mode: options.mode,
        keepPercent: options.keepPercent,
        preferDifferentTracks: options.preferDifferentTracks,
      });
      setPreview(res.data.preview);
      setMessage(`Previewed regeneration for "${playlist.plexPlaylistTitle}".`);
    } catch (requestError: any) {
      console.error(requestError);
      setError(requestError.response?.data?.error || "Failed to preview regeneration.");
    } finally {
      setBusyId("");
    }
  };

  const regeneratePlaylist = async () => {
    if (!selectedPlaylist || !preview) return;
    if (!window.confirm(`Regenerate "${selectedPlaylist.plexPlaylistTitle}"? This will replace the tracks in the existing Plex playlist.`)) return;

    const options = getRegenerationOptions(selectedPlaylist.id);
    setBusyId(selectedPlaylist.id);
    setMessage("");
    setError("");
    try {
      const res = await axios.post(`/api/generated-playlists/${selectedPlaylist.id}/regenerate`, {
        mode: preview.regeneration.mode || options.mode,
        keepPercent: preview.regeneration.keepPercent || options.keepPercent,
        preferDifferentTracks: Boolean(preview.regeneration.preferDifferentTracks ?? options.preferDifferentTracks),
        previewId: preview.previewId,
        trackIds: preview.trackIds,
        warnings: preview.warnings,
        regeneration: preview.regeneration,
      });
      setMessage(`Regenerated "${selectedPlaylist.plexPlaylistTitle}" with ${res.data.trackCount} tracks.`);
      setPreview(null);
      await fetchPlaylists();
    } catch (requestError: any) {
      console.error(requestError);
      setError(requestError.response?.data?.error || "Failed to regenerate playlist.");
    } finally {
      setBusyId("");
    }
  };

  const removeGeneratedPlaylist = async (playlist: GeneratedPlaylist) => {
    const confirmed = window.confirm(`Remove "${playlist.plexPlaylistTitle}" from Generated Playlists? This only removes Mixarr tracking. The Plex playlist will remain unchanged.`);
    if (!confirmed) return;

    setBusyId(playlist.id);
    setMessage("");
    setError("");
    try {
      await axios.delete(`/api/generated-playlists/${playlist.id}`);
      setMessage(`Removed "${playlist.plexPlaylistTitle}" from Generated Playlists.`);
      if (selectedId === playlist.id) {
        setSelectedId("");
        setPreview(null);
      }
      await fetchPlaylists();
    } catch (requestError: any) {
      console.error(requestError);
      setError(requestError.response?.data?.error || "Failed to remove generated playlist tracking.");
    } finally {
      setBusyId("");
    }
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>
            <ListRestart size={14} />
            Playlist Regeneration
          </span>
          <h2>Generated Playlists</h2>
          <p>View playlists created by Mixarr and regenerate them using saved settings.</p>
        </div>
        <Link href="/builder" className={styles.secondaryButton}>
          <Wand2 size={16} />
          Build Playlist
        </Link>
      </header>

      {message && (
        <div className={styles.successNotice}>
          <CheckCircle2 size={16} />
          {message}
        </div>
      )}
      {error && (
        <div className={styles.errorNotice}>
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {loading ? (
        <div className={styles.statePanel}>Loading generated playlists...</div>
      ) : playlists.length === 0 ? (
        <section className={styles.emptyState}>
          <ListRestart size={30} />
          <h3>No Mixarr-generated playlists have been tracked yet.</h3>
          <p>Create a playlist from the builder, Smart Builder, or a recipe to enable regeneration.</p>
          <div>
            <Link href="/builder" className={styles.primaryButton}>Open Builder</Link>
            <Link href="/smart-builder" className={styles.secondaryButton}>Open Smart Builder</Link>
          </div>
        </section>
      ) : (
        <section className={styles.playlistGrid} aria-label="Generated playlists">
          {playlists.map((playlist) => {
            const isSelected = selectedId === playlist.id;
            const isBusy = busyId === playlist.id;
            const regenerationOptions = getRegenerationOptions(playlist.id);
            const presets = [
              playlist.recipeName ? `Recipe: ${playlist.recipeName}` : "",
              playlist.smartPresetName ? `Smart: ${playlist.smartPresetName}` : "",
              playlist.moodPresetName ? `Mood: ${playlist.moodPresetName}` : "",
              playlist.bpmPresetName ? `BPM: ${playlist.bpmPresetName}` : "",
            ].filter(Boolean);

            return (
              <article key={playlist.id} className={`${styles.playlistCard} ${isSelected ? styles.selectedCard : ""}`}>
                <div className={styles.cardTop}>
                  <div>
                    <h3>{playlist.plexPlaylistTitle}</h3>
                    <p>{sourceLabel(playlist.sourceType)}</p>
                  </div>
                  <span>{playlist.trackCount} tracks</span>
                </div>
                <dl className={styles.metaGrid}>
                  <div>
                    <dt>Last generated</dt>
                    <dd>{formatDate(playlist.lastRegeneratedAt || playlist.lastGeneratedAt)}</dd>
                  </div>
                  <div>
                    <dt>Snapshot</dt>
                    <dd>{playlist._count?.tracks || 0} tracks</dd>
                  </div>
                </dl>
                <div className={styles.badgeRow}>
                  {presets.length ? presets.map((preset) => <span key={preset}>{preset}</span>) : <span>Saved filters</span>}
                </div>
                <div className={styles.controls} aria-label={`Regeneration options for ${playlist.plexPlaylistTitle}`}>
                  <div className={styles.modeGroup}>
                    <label className={styles.radioOption}>
                      <input
                        type="radio"
                        name={`mode-${playlist.id}`}
                        checked={regenerationOptions.mode === "replace_all"}
                        onChange={() => updateRegenerationOptions(playlist.id, { mode: "replace_all" })}
                      />
                      <span>
                        <strong>Replace all tracks</strong>
                        <small>Build a fresh version using the saved filters and replace the playlist contents.</small>
                      </span>
                    </label>
                    <label className={styles.radioOption}>
                      <input
                        type="radio"
                        name={`mode-${playlist.id}`}
                        checked={regenerationOptions.mode === "keep_some"}
                        onChange={() => updateRegenerationOptions(playlist.id, { mode: "keep_some" })}
                      />
                      <span>
                        <strong>Keep some existing tracks</strong>
                        <small>Keep 25% or 50% of the current playlist and refill the rest.</small>
                      </span>
                    </label>
                  </div>
                  {regenerationOptions.mode === "keep_some" && (
                    <label className={styles.selectOption}>
                      <span>Keep amount</span>
                      <select
                        value={regenerationOptions.keepPercent}
                        onChange={(event) => updateRegenerationOptions(playlist.id, { keepPercent: Number(event.target.value) as 25 | 50 })}
                      >
                        <option value={25}>25%</option>
                        <option value={50}>50%</option>
                      </select>
                    </label>
                  )}
                  <label className={styles.checkOption}>
                    <input
                      type="checkbox"
                      checked={regenerationOptions.preferDifferentTracks}
                      onChange={(event) => updateRegenerationOptions(playlist.id, { preferDifferentTracks: event.target.checked })}
                    />
                    <span>Prefer different tracks than last time</span>
                  </label>
                </div>
                <div className={styles.actions}>
                  <button type="button" onClick={() => previewRegeneration(playlist)} disabled={Boolean(busyId)} className={styles.primaryButton}>
                    {isBusy ? <RefreshCw size={15} className="animate-spin" /> : <Repeat2 size={15} />}
                    Preview Regeneration
                  </button>
                  <button type="button" disabled={!isSelected || !preview || Boolean(busyId)} onClick={regeneratePlaylist} className={styles.dangerButton}>
                    Regenerate
                  </button>
                  <Link href={`/playlist-history?generatedPlaylistId=${playlist.id}`} className={styles.secondaryButton}>
                    <History size={15} />
                    View History
                  </Link>
                  <button type="button" disabled={Boolean(busyId)} onClick={() => removeGeneratedPlaylist(playlist)} className={styles.secondaryDangerButton}>
                    <Trash2 size={15} />
                    Remove from Generated Playlists
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {selectedPlaylist && preview && (
        <section className={styles.previewPanel} aria-labelledby="regeneration-preview">
          <div className={styles.previewHeader}>
            <div>
              <span className={styles.kicker}>
                <ShieldCheck size={14} />
                Preview Required
              </span>
              <h3 id="regeneration-preview">Regeneration Preview: {selectedPlaylist.plexPlaylistTitle}</h3>
              <p>The tracks below are the exact order Mixarr will write to Plex after confirmation.</p>
            </div>
            <button type="button" onClick={regeneratePlaylist} disabled={Boolean(busyId) || preview.trackIds.length === 0} className={styles.dangerButton}>
              {busyId === selectedPlaylist.id ? <RefreshCw size={15} className="animate-spin" /> : <Repeat2 size={15} />}
              Regenerate Playlist
            </button>
          </div>

          <div className={styles.statsGrid}>
            <div><span>Current count</span><strong>{preview.regeneration.currentPlaylistTrackCount}</strong></div>
            <div><span>New preview</span><strong>{preview.regeneration.newPreviewTrackCount}</strong></div>
            {preview.regeneration.mode === "keep_some" ? (
              <>
                <div><span>Tracks kept</span><strong>{preview.regeneration.tracksKept}</strong></div>
                <div><span>Tracks replaced</span><strong>{preview.regeneration.tracksReplaced}</strong></div>
                <div><span>Keep amount</span><strong>{preview.regeneration.keepPercent}%</strong></div>
                <div><span>New tracks added</span><strong>{preview.regeneration.newTracksAdded ?? preview.regeneration.newTracks}</strong></div>
              </>
            ) : (
              <>
                <div><span>Tracks reused</span><strong>{preview.regeneration.snapshotAvailable ? preview.regeneration.tracksReused : "N/A"}</strong></div>
                <div><span>New tracks</span><strong>{preview.regeneration.snapshotAvailable ? preview.regeneration.newTracks : "N/A"}</strong></div>
              </>
            )}
            <div><span>Removed tracks</span><strong>{preview.regeneration.snapshotAvailable ? preview.regeneration.removedTracks : "N/A"}</strong></div>
            <div><span>Manual exclusions</span><strong>{preview.summary.manualExclusionsRemoved || 0}</strong></div>
            <div><span>Safety removed</span><strong>{preview.summary.removedBySafetyRules || 0}</strong></div>
            {preview.regeneration.preferDifferentTracks && (
              <div><span>Previous tracks avoided</span><strong>{preview.regeneration.snapshotAvailable ? preview.regeneration.previousTracksAvoided || 0 : "N/A"}</strong></div>
            )}
          </div>

          {preview.regeneration.mode === "keep_some" && (
            <p className={styles.previewSummary}>
              Keeping {preview.regeneration.keepPercent}%: {preview.regeneration.tracksKept} tracks kept, {preview.regeneration.tracksReplaced} tracks replaced, {preview.regeneration.newPreviewTrackCount} total preview tracks.
            </p>
          )}

          <div className={styles.contextRow}>
            {preview.regeneration.recipeName && <span>Recipe: {preview.regeneration.recipeName}</span>}
            {preview.regeneration.smartPresetName && <span>Smart preset: {preview.regeneration.smartPresetName}</span>}
            {preview.regeneration.moodPresetName && <span>Mood preset: {preview.regeneration.moodPresetName}</span>}
            {preview.regeneration.bpmPresetName && <span>BPM preset: {preview.regeneration.bpmPresetName}</span>}
            <span>{preview.summary.safetyRuleSummary || "Safety rules: off"}</span>
          </div>

          {preview.warnings.length > 0 && (
            <div className={styles.warningPanel}>
              <div><AlertTriangle size={16} /> Warnings</div>
              {preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </div>
          )}

          <div className={styles.trackList}>
            {preview.tracks.length === 0 ? (
              <div className={styles.statePanel}>No tracks matched this regeneration preview.</div>
            ) : preview.tracks.map((track, index) => (
              <article key={track.id} className={styles.trackCard}>
                <span className={styles.trackIndex}>{index + 1}</span>
                <div>
                  <h4>{track.title || "-"}</h4>
                  <p>{track.artist?.title || "-"} - {track.album?.title || "-"}</p>
                  <div className={styles.trackMeta}>
                    <span>{formatDuration(track.duration)}</span>
                    <span>BPM {(track.effectiveBpm ?? track.bpm ?? track.audioFeature?.tempo)?.toFixed(0) || "-"}</span>
                    <span>Energy {(track.audioFeature?.effectiveEnergy ?? track.audioFeature?.energy)?.toFixed(2) || "-"}</span>
                    <span>Mood {(track.audioFeature?.effectiveMood ?? track.audioFeature?.valence)?.toFixed(2) || "-"}</span>
                    <span>Popularity {track.popularity?.score?.toFixed(0) || "-"}</span>
                  </div>
                </div>
                <div className={styles.trackActions}>
                  <TrackPreviewButton trackId={track.id} />
                  <span title="Manual exclusions apply during regeneration"><Ban size={14} /></span>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
