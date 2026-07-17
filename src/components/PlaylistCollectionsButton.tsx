"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Grid2X2 } from "lucide-react";
import styles from "./PlaylistCollectionsButton.module.css";
type Group = { id: string; name: string };
export default function PlaylistCollectionsButton({ playlistId }: { playlistId: string }) {
  const [groups, setGroups] = useState<Group[]>([]); const [members, setMembers] = useState<string[]>([]); const [open, setOpen] = useState(false); const [error, setError] = useState("");
  useEffect(() => { if (!open) return; void fetch(`/api/playlists/${playlistId}/groups`).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error?.message || "Unable to load collections"); setGroups(body.groups); setMembers(body.memberships.map((item: any) => item.playlistGroupId)); }).catch((caught) => setError(caught.message)); }, [open, playlistId]);
  async function add(groupId: string) { const response = await fetch(`/api/playlists/${playlistId}/groups`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId }) }); const body = await response.json(); if (!response.ok) { setError(body.error?.message || "Unable to add collection"); return; } setMembers([...members, groupId]); }
  return <div className={styles.root}><button type="button" onClick={() => setOpen(!open)} aria-expanded={open}><Grid2X2 size={15}/> Collections {members.length ? `(${members.length})` : ""}</button>{open && <div className={styles.popover}><strong>Collections</strong>{error && <p>{error}</p>}{groups.map((group) => <div key={group.id}><Link href={`/playlist-groups/${group.id}`}>{group.name}</Link>{members.includes(group.id) ? <span>Member</span> : <button onClick={() => void add(group.id)}>Add</button>}</div>)}{groups.length === 0 && !error && <small>No collections yet.</small>}<Link className={styles.manage} href="/playlist-groups">Manage Collections</Link></div>}</div>;
}
