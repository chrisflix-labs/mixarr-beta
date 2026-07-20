"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { AlertTriangle, CheckCircle2, Home, ShieldCheck, Users, Vote } from "lucide-react";
import styles from "./HouseholdCollaborationPanel.module.css";

function label(value?: string | null) { return String(value || "").toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }

export default function HouseholdCollaborationPanel({ playlistId }: { playlistId: string }) {
  const [details, setDetails] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(() => { setLoading(true); axios.get(`/api/generated-playlists/${playlistId}/household`).then((response) => setDetails(response.data.collaboration)).catch((caught) => { if (caught?.response?.status !== 404) setError(caught?.response?.data?.error?.message || "Could not load household collaboration"); }).finally(() => setLoading(false)); }, [playlistId]);
  useEffect(() => { load(); }, [load]);
  const approve = async () => { try { await axios.post(`/api/generated-playlists/${playlistId}/approvals`, { playlistVersion: details.configuration.generatedPlaylist.revisionCounter + 1, status: "APPROVED" }); load(); } catch (caught: any) { setError(caught?.response?.data?.error?.message || "Approval failed"); } };
  const vote = async (voteType: string) => { try { await axios.post(`/api/generated-playlists/${playlistId}/votes`, { playlistVersion: details.configuration.generatedPlaylist.revisionCounter + 1, voteType }); load(); } catch (caught: any) { setError(caught?.response?.data?.error?.message || "Vote failed"); } };
  const publish = async () => { try { await axios.post(`/api/generated-playlists/${playlistId}/publish`); load(); } catch (caught: any) { setError(caught?.response?.data?.error?.message || "Plex publish failed"); } };
  const toggleParticipant = async (participant: any) => { try { await axios.patch(`/api/generated-playlists/${playlistId}/participants/${participant.id}`, { temporarilyExcluded: !participant.temporarilyExcluded, exclusionExpiresAt: null }); load(); } catch (caught: any) { setError(caught?.response?.data?.error?.message || "Participant exclusion failed"); } };
  if (loading || !details) return error ? <div className={styles.error}>{error}</div> : null;
  const snapshot = details.configuration.generationSnapshotJson || {};
  return <section className={styles.panel}>
    <div className={styles.header}><div><span><Home size={14} /> Household collaboration</span><h4>{details.configuration.household.name}</h4></div><em>{label(details.configuration.publicationStatus)}</em></div>
    <div className={styles.summary}><span><Users size={13} /> {details.configuration.participants.filter((participant: any) => participant.isActive && !participant.temporarilyExcluded).length} participants</span><span>{label(details.configuration.balanceMode)}</span><span><ShieldCheck size={13} /> {label(details.configuration.familyRule)}</span></div>
    <div className={styles.bars}>{details.configuration.participants.map((participant: any) => { const profile = participant.householdMember || participant.householdGuest; return <div key={participant.id}><span>{profile?.displayName}</span><i><b style={{ width: `${participant.effectiveInfluence * 100}%` }} /></i><strong>{Math.round(participant.effectiveInfluence * 100)}%</strong>{participant.capReduction > 0 && <em>cap applied</em>}<button title="Preferences are retained" onClick={() => toggleParticipant(participant)}>{participant.temporarilyExcluded ? "Restore" : "Exclude"}</button></div>; })}{details.configuration.sharedFavoritesWeight > 0 && <div><span>Shared favorites</span><i><b style={{ width: `${details.configuration.sharedFavoritesWeight * 100}%` }} /></i><strong>{Math.round(details.configuration.sharedFavoritesWeight * 100)}%</strong></div>}</div>
    {details.conflicts.length > 0 && <details><summary><AlertTriangle size={13} /> {details.conflicts.length} detected preference conflict{details.conflicts.length === 1 ? "" : "s"}</summary>{details.conflicts.slice(0, 8).map((conflict: any) => <p key={conflict.id}><strong>{label(conflict.category)}</strong> - severity {conflict.severity} - {label(conflict.resolutionMethod)}{conflict.affectedSelection ? " - affected selection" : ""}</p>)}</details>}
    {details.contributions.length > 0 && <details><summary>{details.contributions.length} track contribution explanation{details.contributions.length === 1 ? "" : "s"}</summary>{details.contributions.slice(0, 25).map((contribution: any) => <p key={contribution.id}><strong>{contribution.track?.title || contribution.trackId}</strong>{contribution.track?.artist?.title ? ` by ${contribution.track.artist.title}` : ""} - {label(contribution.contributionType)}. {contribution.selectionReason}{contribution.conflictStatus && contribution.conflictStatus !== "NONE" ? ` Conflict: ${label(contribution.conflictStatus)}.` : ""}</p>)}</details>}
    {snapshot.familyRule?.reason && <p className={styles.rule}>{snapshot.familyRule.reason}</p>}
    <div className={styles.approval}><span><CheckCircle2 size={14} /> Approvals: {details.approvalProgress.approved}/{details.approvalProgress.required} {details.approvalProgress.satisfied ? "complete" : `- ${details.approvalProgress.remaining} remaining`}</span>{!details.approvalProgress.satisfied && <button onClick={approve}>Approve</button>}{details.approvalProgress.satisfied && details.configuration.publicationStatus === "APPROVED" && <button onClick={publish}>Publish to Plex</button>}</div>
    {details.configuration.votingEnabled && <div className={styles.vote}><span><Vote size={14} /> Playlist vote</span><button onClick={() => vote("APPROVE")}>Approve</button><button onClick={() => vote("NEUTRAL")}>Neutral</button><button onClick={() => vote("DISAPPROVE")}>Disapprove</button></div>}
    {error && <div className={styles.error}>{error}</div>}
  </section>;
}
