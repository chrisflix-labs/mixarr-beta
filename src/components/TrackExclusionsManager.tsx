"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { RotateCcw, Ban } from "lucide-react";
import styles from "@/app/settings/settings.module.css";

type TrackExclusion = {
  id: string;
  trackId: string;
  reason?: string | null;
  createdAt: string;
  track?: {
    title?: string | null;
    artist?: { title?: string | null } | null;
    album?: { title?: string | null } | null;
  } | null;
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString();
}

export default function TrackExclusionsManager() {
  const [exclusions, setExclusions] = useState<TrackExclusion[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const loadExclusions = async () => {
    setLoading(true);
    try {
      const res = await axios.get("/api/track-exclusions");
      setExclusions(res.data.exclusions || []);
    } catch (error) {
      console.error("Failed to load track exclusions", error);
      setMessage("Unable to load excluded tracks.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadExclusions();
  }, []);

  const removeExclusion = async (exclusion: TrackExclusion) => {
    const title = exclusion.track?.title || "this track";
    if (!window.confirm(`Allow "${title}" in Mixarr playlists again?`)) return;

    try {
      await axios.delete(`/api/track-exclusions/${exclusion.id}`);
      setExclusions((current) => current.filter((item) => item.id !== exclusion.id));
      setMessage(`"${title}" can appear in future Mixarr playlists again.`);
    } catch (error) {
      console.error("Failed to remove track exclusion", error);
      setMessage("Unable to remove that track exclusion.");
    }
  };

  return (
    <div className={styles.exclusionsManager}>
      <div className={styles.exclusionsIntro}>
        <Ban size={18} />
        <p>Exclude tracks from playlist previews when you do not want Mixarr to use them.</p>
      </div>

      {message && <p className={styles.inlineNote}>{message}</p>}

      {loading ? (
        <div className={styles.emptyExclusions}>Loading excluded tracks...</div>
      ) : exclusions.length === 0 ? (
        <div className={styles.emptyExclusions}>
          <strong>No tracks are manually excluded yet.</strong>
          <span>Use Exclude from a playlist preview to add tracks here.</span>
        </div>
      ) : (
        <div className={styles.exclusionList}>
          {exclusions.map((exclusion) => (
            <article key={exclusion.id} className={styles.exclusionItem}>
              <div>
                <strong>{exclusion.track?.title || "Unknown track"}</strong>
                <span>
                  {exclusion.track?.artist?.title || "Unknown artist"}
                  {" / "}
                  {exclusion.track?.album?.title || "Unknown album"}
                </span>
                <small>
                  Excluded {formatDate(exclusion.createdAt)}
                  {exclusion.reason ? ` / ${exclusion.reason}` : ""}
                </small>
              </div>
              <button type="button" className={styles.secondaryButton} onClick={() => removeExclusion(exclusion)}>
                <RotateCcw size={15} />
                Remove Exclusion
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
