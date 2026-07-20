"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Archive, Home, Plus, RefreshCw, UserMinus, UserPlus, Users } from "lucide-react";
import styles from "./HouseholdWorkspace.module.css";

type Household = any;
type SafeUser = { id: string; username: string; thumb?: string | null };

function errorMessage(error: any) { return error?.response?.data?.error?.message || error?.response?.data?.error || error?.message || "Household request failed"; }
function percent(value: number) { return `${Math.round(Number(value || 0) * 100)}%`; }

export default function HouseholdWorkspace() {
  const [households, setHouseholds] = useState<Household[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [household, setHousehold] = useState<Household | null>(null);
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [newName, setNewName] = useState("");
  const [memberUserId, setMemberUserId] = useState("");
  const [guestName, setGuestName] = useState("");
  const [tab, setTab] = useState("overview");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadList = useCallback(async () => { const response = await axios.get("/api/households?includeArchived=true"); setHouseholds(response.data.households || []); if (!selectedId && response.data.households?.[0]) setSelectedId(response.data.households[0].id); }, [selectedId]);
  const loadHousehold = useCallback(async (id = selectedId) => { if (!id) { setHousehold(null); return; } const response = await axios.get(`/api/households/${id}`); setHousehold(response.data.household); }, [selectedId]);
  const reload = useCallback(async () => { setBusy(true); setError(""); try { await Promise.all([loadList(), axios.get("/api/households/available-users").then((response) => setUsers(response.data.users || []))]); if (selectedId) await loadHousehold(); } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); } }, [loadHousehold, loadList, selectedId]);
  useEffect(() => { void reload(); }, [reload]);

  const availableUsers = useMemo(() => users.filter((user) => !household?.members?.some((member: any) => member.userId === user.id && member.isActive)), [users, household]);
  const mutate = async (work: () => Promise<any>, message: string) => { setBusy(true); setError(""); setNotice(""); try { await work(); setNotice(message); await loadList(); if (selectedId) await loadHousehold(); } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); } };
  const create = () => mutate(async () => { const response = await axios.post("/api/households", { name: newName }); setSelectedId(response.data.household.id); setNewName(""); }, "Household created.");
  const addMember = () => mutate(() => axios.post(`/api/households/${selectedId}/members`, { userId: memberUserId }), "Member added.").then(() => setMemberUserId(""));
  const addGuest = () => mutate(() => axios.post(`/api/households/${selectedId}/guests`, { displayName: guestName, isReusable: false, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }), "Guest profile added.").then(() => setGuestName(""));

  return <main className={styles.page}>
    <header className={styles.header}><div><span className={styles.kicker}><Home size={15} /> Household collaboration</span><h1>Households</h1><p>Combine preferences fairly while keeping every person’s feedback and influence explainable.</p></div><button onClick={() => void reload()} disabled={busy}><RefreshCw size={16} className={busy ? "animate-spin" : ""} /> Refresh</button></header>
    {error && <div className={styles.error}>{error}</div>}{notice && <div className={styles.notice}>{notice}</div>}
    <section className={styles.createCard}><input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Household name" maxLength={120} /><button onClick={create} disabled={busy || !newName.trim()}><Plus size={16} /> Create household</button></section>
    <div className={styles.layout}>
      <aside className={styles.householdList}>{households.map((item) => <button key={item.id} className={selectedId === item.id ? styles.selected : ""} onClick={() => setSelectedId(item.id)}><strong>{item.name}</strong><span>{item._count?.members || 0} members · {item._count?.playlistConfigurations || 0} playlists</span>{item.status === "ARCHIVED" && <em>Archived</em>}</button>)}</aside>
      <section className={styles.detail}>{!household ? <div className={styles.empty}>Create or select a household.</div> : <>
        <div className={styles.detailHeader}><div><h2>{household.name}</h2><p>{household.description || "No description yet."}</p></div>{household.status === "ACTIVE" && <button className={styles.danger} onClick={() => mutate(() => axios.delete(`/api/households/${selectedId}`), "Household archived; history was retained.")}><Archive size={15} /> Archive</button>}</div>
        <nav className={styles.tabs}>{["overview", "members", "guests", "preferences", "activity"].map((value) => <button key={value} className={tab === value ? styles.activeTab : ""} onClick={() => setTab(value)}>{value}</button>)}</nav>
        {tab === "overview" && <div className={styles.stats}><article><span>Members</span><strong>{household.members.filter((member: any) => member.isActive).length}</strong></article><article><span>Shared playlists</span><strong>{household.playlistConfigurations.length}</strong></article><article><span>Default balance</span><strong>{household.defaultBalanceMode.replaceAll("_", " ")}</strong></article><article><span>Member cap</span><strong>{percent(household.defaultMaximumInfluence)}</strong></article></div>}
        {tab === "members" && <><div className={styles.addRow}><select value={memberUserId} onChange={(event) => setMemberUserId(event.target.value)}><option value="">Select a Mixarr user</option>{availableUsers.map((user) => <option key={user.id} value={user.id}>{user.username}</option>)}</select><button onClick={addMember} disabled={!memberUserId || busy}><UserPlus size={15} /> Add member</button></div><div className={styles.rows}>{household.members.map((member: any) => <article key={member.id} className={!member.isActive ? styles.inactive : ""}><div><strong>{member.displayName}</strong><span>{member.memberType.toLowerCase()} · configured {member.influenceWeight}</span></div><label>Influence <input type="number" min="0" max="100" step="0.1" defaultValue={member.influenceWeight} onBlur={(event) => Number(event.target.value) !== member.influenceWeight && mutate(() => axios.patch(`/api/households/${selectedId}/members/${member.id}`, { influenceWeight: Number(event.target.value) }), "Influence updated.")} /></label><label className={styles.check}><input type="checkbox" checked={member.temporarilyExcluded} onChange={(event) => mutate(() => axios.patch(`/api/households/${selectedId}/members/${member.id}`, { temporarilyExcluded: event.target.checked, exclusionExpiresAt: null }), event.target.checked ? "Member excluded." : "Member restored.")} /> Excluded</label>{member.memberType !== "OWNER" && member.isActive && <button className={styles.iconButton} title="Remove member while retaining history" onClick={() => mutate(() => axios.delete(`/api/households/${selectedId}/members/${member.id}`), "Member removed; history retained.")}><UserMinus size={15} /></button>}</article>)}</div></>}
        {tab === "guests" && <><div className={styles.addRow}><input value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="Guest display name" /><button onClick={addGuest} disabled={!guestName.trim() || busy}><Plus size={15} /> Add 24-hour guest</button></div><div className={styles.rows}>{household.guests.map((guest: any) => <article key={guest.id} className={!guest.isActive ? styles.inactive : ""}><div><strong>{guest.displayName}</strong><span>{guest.isReusable ? "Reusable" : "Temporary"} · {guest.expiresAt ? `expires ${new Date(guest.expiresAt).toLocaleString()}` : "no expiration"}</span></div><button onClick={() => mutate(() => axios.post(`/api/households/${selectedId}/guests/${guest.id}/reset`), "Guest feedback reset.")}>Reset feedback</button>{guest.isActive && <button className={styles.danger} onClick={() => mutate(() => axios.delete(`/api/households/${selectedId}/guests/${guest.id}`), "Guest removed.")}>Remove</button>}</article>)}</div></>}
        {tab === "preferences" && <div className={styles.rows}>{household.preferences.length ? household.preferences.map((preference: any) => <article key={preference.id}><div><strong>{preference.state.replaceAll("_", " ")}</strong><span>{preference.targetType.toLowerCase()} · {preference.targetId}</span></div><em>{preference.scope.toLowerCase()}</em></article>) : <div className={styles.empty}>No shared feedback has been recorded.</div>}</div>}
        {tab === "activity" && <div className={styles.timeline}>{household.activities.map((event: any) => <article key={event.id}><span>{new Date(event.createdAt).toLocaleString()}</span><strong>{event.eventType.replaceAll("_", " ")}</strong><p>{event.summary}</p></article>)}</div>}
      </>}</section>
    </div>
  </main>;
}
