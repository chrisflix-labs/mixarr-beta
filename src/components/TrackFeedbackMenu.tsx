"use client";

import { useEffect, useState } from "react";
import { Ban, ChevronDown, Heart, HeartOff, ListPlus, MessageSquareWarning, RotateCcw, ThumbsDown, ThumbsUp, UserMinus, UserRoundPlus } from "lucide-react";
import styles from "./TrackFeedbackMenu.module.css";

const reasons = [
  ["", "No reason"], ["WRONG_MOOD", "Wrong mood"], ["TOO_REPETITIVE", "Too repetitive"], ["BAD_BPM_TRANSITION", "BPM transition is bad"],
  ["ARTIST_OVERREPRESENTED", "Artist appears too often"], ["DISLIKED_TRACK", "I do not like this track"], ["POOR_PLAYLIST_FIT", "Does not fit this playlist"], ["OTHER", "Other"],
] as const;

type Props = {
  trackId: string; artistId?: string | null; playlistId?: string | null; generationId?: string | null;
  previousTrack?: { id: string; title: string; bpm?: number | null; effectiveBpm?: number | null; mood?: number | null; energy?: number | null } | null;
  trackTitle?: string; currentTrack?: { bpm?: number | null; effectiveBpm?: number | null; mood?: number | null; energy?: number | null };
  sourceSurface?: "PLAYLIST_PREVIEW" | "REGENERATION_PREVIEW" | "GENERATED_PLAYLIST_DETAILS" | "TRACK_TABLE" | "LIBRARY_SEARCH";
  initialTrackState?: string | null; initialArtistState?: string | null; initialFitState?: string | null; initialPoorTransition?: boolean;
  onChanged?: (state: { trackState: string | null; artistState: string | null; fitState: string | null; poorTransition: boolean }) => void;
};

async function mutate(path: string, method: string, body: unknown) {
  const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || payload.error || "Feedback could not be saved");
  return payload;
}

export default function TrackFeedbackMenu(props: Props) {
  const [trackState, setTrackState] = useState(props.initialTrackState || null);
  const [artistState, setArtistState] = useState(props.initialArtistState || null);
  const [fitState, setFitState] = useState(props.initialFitState || null);
  const [poorTransition, setPoorTransition] = useState(Boolean(props.initialPoorTransition));
  const [reason, setReason] = useState(""); const [busy, setBusy] = useState(""); const [message, setMessage] = useState("");
  useEffect(() => { setTrackState(props.initialTrackState || null); setArtistState(props.initialArtistState || null); setFitState(props.initialFitState || null); setPoorTransition(Boolean(props.initialPoorTransition)); }, [props.initialTrackState, props.initialArtistState, props.initialFitState, props.initialPoorTransition]);
  function changed(next: Partial<{ trackState: string | null; artistState: string | null; fitState: string | null; poorTransition: boolean }>) { const value = { trackState, artistState, fitState, poorTransition, ...next }; props.onChanged?.(value); }
  function note() { return reason === "OTHER" ? window.prompt("Optional short note", "")?.trim().slice(0, 240) || undefined : undefined; }
  async function run(key: string, action: () => Promise<void>) { if (busy) return; setBusy(key); setMessage(""); try { await action(); setMessage("Saved"); } catch (error) { setMessage(error instanceof Error ? error.message : "Feedback failed"); } finally { setBusy(""); } }
  const common = { reason: reason || undefined, note: note, sourceSurface: props.sourceSurface || "PLAYLIST_PREVIEW", playlistId: props.playlistId || undefined, generationId: props.generationId || undefined };
  async function track(state: "LIKED" | "DISLIKED" | "NEVER_RECOMMEND") { if (state === "NEVER_RECOMMEND" && !window.confirm(`Never recommend “${props.trackTitle || "this track"}” again? Existing playlists will not be changed.`)) return; const optionalNote = note(); await run(`track:${state}`, async () => { await mutate("/api/feedback/tracks", "POST", { ...common, note: optionalNote, trackId: props.trackId, state }); setTrackState(state); changed({ trackState: state }); }); }
  async function artist(state: "PREFER" | "RECOMMEND_LESS") { if (!props.artistId) return; const optionalNote = note(); await run(`artist:${state}`, async () => { await mutate("/api/feedback/artists", "POST", { ...common, note: optionalNote, artistId: props.artistId, state }); setArtistState(state); changed({ artistState: state }); }); }
  async function fit(state: "GOOD_FIT" | "POOR_FIT") { const optionalNote = note(); await run(`fit:${state}`, async () => { await mutate("/api/feedback/playlist-fit", "POST", { ...common, note: optionalNote, trackId: props.trackId, state }); setFitState(state); changed({ fitState: state }); }); }
  async function transition() { if (!props.previousTrack) return; const optionalNote = note(); await run("transition", async () => { await mutate("/api/feedback/transitions", "POST", { ...common, note: optionalNote, previousTrackId: props.previousTrack!.id, currentTrackId: props.trackId, context: { previousBpm: props.previousTrack!.bpm, currentBpm: props.currentTrack?.bpm, previousEffectiveBpm: props.previousTrack!.effectiveBpm, currentEffectiveBpm: props.currentTrack?.effectiveBpm, previousMood: props.previousTrack!.mood, currentMood: props.currentTrack?.mood, previousEnergy: props.previousTrack!.energy, currentEnergy: props.currentTrack?.energy } }); setPoorTransition(true); changed({ poorTransition: true }); }); }
  async function clearTrack() { await run("clear", async () => { await mutate("/api/feedback/tracks", "DELETE", { trackId: props.trackId, sourceSurface: common.sourceSurface }); setTrackState(null); changed({ trackState: null }); }); }
  async function clearArtist() { if (!props.artistId) return; await run("clearArtist", async () => { await mutate("/api/feedback/artists", "DELETE", { artistId: props.artistId, sourceSurface: common.sourceSurface }); setArtistState(null); changed({ artistState: null }); }); }

  return <div className={styles.wrapper}>
    <details className={styles.menu}>
      <summary aria-label={`Feedback for ${props.trackTitle || "track"}`}><MessageSquareWarning size={15} /><span className={styles.summaryText}>Feedback</span><ChevronDown size={13} /></summary>
      <div className={styles.popover}>
        <div className={styles.states} aria-live="polite">{trackState && <span>{trackState.replaceAll("_", " ")}</span>}{artistState && <span>{artistState.replaceAll("_", " ")}</span>}{fitState && <span>{fitState.replaceAll("_", " ")}</span>}{poorTransition && <span>POOR TRANSITION</span>}</div>
        <label className={styles.reason}>Optional reason<select value={reason} onChange={(event) => setReason(event.target.value)}>{reasons.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <button disabled={Boolean(busy)} onClick={() => track("LIKED")} aria-pressed={trackState === "LIKED"}><ThumbsUp size={14} /> Like track</button>
        <button disabled={Boolean(busy)} onClick={() => track("DISLIKED")} aria-pressed={trackState === "DISLIKED"}><ThumbsDown size={14} /> Dislike track</button>
        <button className={styles.danger} disabled={Boolean(busy)} onClick={() => track("NEVER_RECOMMEND")} aria-pressed={trackState === "NEVER_RECOMMEND"}><Ban size={14} /> Never recommend</button>
        <button disabled={Boolean(busy) || !props.artistId} onClick={() => artist("PREFER")} aria-pressed={artistState === "PREFER"}><UserRoundPlus size={14} /> Prefer this artist</button>
        <button disabled={Boolean(busy) || !props.artistId} onClick={() => artist("RECOMMEND_LESS")} aria-pressed={artistState === "RECOMMEND_LESS"}><UserMinus size={14} /> Recommend less artist</button>
        <button disabled={Boolean(busy) || (!props.playlistId && !props.generationId)} onClick={() => fit("GOOD_FIT")} aria-pressed={fitState === "GOOD_FIT"}><ListPlus size={14} /> Good playlist fit</button>
        <button disabled={Boolean(busy) || (!props.playlistId && !props.generationId)} onClick={() => fit("POOR_FIT")} aria-pressed={fitState === "POOR_FIT"}><HeartOff size={14} /> Poor playlist fit</button>
        {props.previousTrack && <button disabled={Boolean(busy)} onClick={transition} aria-pressed={poorTransition}><Heart size={14} /> Poor: {props.previousTrack.title} → {props.trackTitle}</button>}
        {trackState && <button disabled={Boolean(busy)} onClick={clearTrack}><RotateCcw size={14} /> Clear track feedback</button>}
        {artistState && <button disabled={Boolean(busy)} onClick={clearArtist}><RotateCcw size={14} /> Clear artist feedback</button>}
        {message && <p className={message === "Saved" ? styles.success : styles.error} role="status">{message}</p>}
      </div>
    </details>
  </div>;
}
