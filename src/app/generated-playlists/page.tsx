"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { AlertTriangle, Ban, CheckCircle2, ListRestart, RefreshCw, Repeat2, ShieldCheck, Sparkles, Wand2 } from "lucide-react";
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
    currentPlaylistTrackCount: number;
    previousSnapshotTrackCount: number;
    newPreviewTrackCount: number;
    tracksReused: number;
    newTracks: number;
    removedTracks: number;
    snapshotAvailable: boolean;
    recipeName?: string | null;
    smartPresetName?: string | null;
    moodPresetName?: string | null;
    bpmPresetName?: string | null;
  };
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
  const [mode, setMode] = useState("replace_all");
  const [preferDifferentTracks, setPreferDifferentTracks] = useState(false);
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

  const previewRegeneration = async (playlist: GeneratedPlaylist) => {
    setBusyId(playlist.id);
    setSelectedId(playlist.id);
    setPreview(null);
    setMessage("");
    setError("");
    try {
      const res = await axios.post(`/api/generated-playlists/${playlist.id}/preview-regeneration`, {
        mode,
        preferDifferentTracks,
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

    setBusyId(selectedPlaylist.id);
    setMessage("");
    setError("");
    try {
      const res = await axios.post(`/api/generated-playlists/${selectedPlaylist.id}/regenerate`, {
        mode,
        previewId: preview.previewId,
        trackIds: preview.trackIds,
        warnings: preview.warnings,
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

      <section className={styles.controls} aria-label="Regeneration options">
        <div className={styles.modeGroup}>
          <label className={styles.radioOption}>
            <input type="radio" checked={mode === "replace_all"} onChange={() => setMode("replace_all")} />
            <span>
              <strong>Replace all tracks</strong>
              <small>Build a fresh version using the saved filters and replace the playlist contents.</small>
            </span>
          </label>
          <label className={`${styles.radioOption} ${styles.disabledOption}`}>
            <input type="radio" disabled />
            <span>
              <strong>Keep some existing tracks</strong>
              <small>Keep 25% or 50% of the current playlist and refill the rest. Coming later.</small>
            </span>
          </label>
        </div>
        <label className={styles.checkOption}>
          <input type="checkbox" checked={preferDifferentTracks} onChange={(event) => setPreferDifferentTracks(event.target.checked)} />
          <span>Prefer different tracks than last time</span>
        </label>
      </section>

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
                <div className={styles.actions}>
                  <button type="button" onClick={() => previewRegeneration(playlist)} disabled={Boolean(busyId)} className={styles.primaryButton}>
                    {isBusy ? <RefreshCw size={15} className="animate-spin" /> : <Repeat2 size={15} />}
                    Preview Regeneration
                  </button>
                  <button type="button" disabled={!isSelected || !preview || Boolean(busyId)} onClick={regeneratePlaylist} className={styles.dangerButton}>
                    Regenerate
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
            <div><span>Tracks reused</span><strong>{preview.regeneration.snapshotAvailable ? preview.regeneration.tracksReused : "N/A"}</strong></div>
            <div><span>New tracks</span><strong>{preview.regeneration.snapshotAvailable ? preview.regeneration.newTracks : "N/A"}</strong></div>
            <div><span>Removed tracks</span><strong>{preview.regeneration.snapshotAvailable ? preview.regeneration.removedTracks : "N/A"}</strong></div>
            <div><span>Manual exclusions</span><strong>{preview.summary.manualExclusionsRemoved || 0}</strong></div>
            <div><span>Safety removed</span><strong>{preview.summary.removedBySafetyRules || 0}</strong></div>
            <div><span>Matched</span><strong>{preview.summary.matchingTrackCount}</strong></div>
          </div>

          <div className={styles.contextRow}>
            {preview.regeneration.recipeName && <span>Recipe: {preview.regeneration.recipeName}</span>}
            {preview.regeneration.smartPresetName && <span>Smart preset: {preview.regeneration.smartPresetName}</span>}
            {preview.regeneration.moodPresetName && <span>Mood preset: {preview.regeneration.moodPresetName}</span>}
            {preview.regeneration.bpmPresetName && <span>BPM preset: {preview.regeneration.bpmPresetName}</span>}
            <span>{preview.summary.safetyRuleSummary || "Safety: off"}</span>
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
