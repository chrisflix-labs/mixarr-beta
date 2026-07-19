"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { ArrowLeft, Search, Trash2 } from "lucide-react";
import styles from "./recipe-mappings.module.css";

type SavedMapping = { id: string; mappingType: string; sourceValueDisplay: string; destinationValuesJson: string[]; confidence: number; manuallyConfirmed: boolean; enabled: boolean; usageCount: number; lastUsedAt?: string | null; updatedAt: string; library?: { name: string } | null };

export default function RecipeMappingsSettingsPage() {
  const [items, setItems] = useState<SavedMapping[]>([]); const [search, setSearch] = useState(""); const [type, setType] = useState(""); const [busy, setBusy] = useState(""); const [error, setError] = useState("");
  const load = async () => { try { setItems((await axios.get("/api/recipe-mappings?includeDisabled=1")).data.mappings || []); } catch (caught: any) { setError(caught.response?.data?.error || "Saved recipe mappings could not be loaded."); } };
  useEffect(() => { load(); }, []);
  const filtered = useMemo(() => items.filter((item) => !type || item.mappingType === type).filter((item) => !search || `${item.sourceValueDisplay} ${item.destinationValuesJson.join(" ")}`.toLowerCase().includes(search.toLowerCase())), [items, search, type]);
  const toggle = async (item: SavedMapping) => { setBusy(item.id); try { await axios.patch(`/api/recipe-mappings/${item.id}`, { enabled: !item.enabled }); setItems((current) => current.map((value) => value.id === item.id ? { ...value, enabled: !value.enabled } : value)); } catch (caught: any) { setError(caught.response?.data?.error || "Mapping could not be updated."); } finally { setBusy(""); } };
  const remove = async (item: SavedMapping) => { if (!window.confirm(`Delete the saved mapping for “${item.sourceValueDisplay}”? Imported recipes are not changed.`)) return; setBusy(item.id); try { await axios.delete(`/api/recipe-mappings/${item.id}`); setItems((current) => current.filter((value) => value.id !== item.id)); } catch (caught: any) { setError(caught.response?.data?.error || "Mapping could not be deleted."); } finally { setBusy(""); } };
  return <main className={styles.page}><header><div><Link href="/recipes"><ArrowLeft size={16} /> Recipe Library</Link><h2>Saved Recipe Mappings</h2><p>Confirmed mappings take precedence during future imports. Disabling or deleting a rule never changes recipes already imported.</p></div></header>
    {error && <p className={styles.error}>{error}</p>}
    <section className={styles.filters}><label><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search source or destination" /></label><select value={type} onChange={(event) => setType(event.target.value)}><option value="">All mapping types</option><option value="genre">Genres</option><option value="mood">Moods</option><option value="artist">Artists</option><option value="bpm">BPM</option><option value="energy">Energy</option></select></section>
    <section className={styles.list}>{filtered.length ? filtered.map((item) => <article key={item.id} data-enabled={item.enabled}><div><small>{item.mappingType} · {item.library?.name || "All libraries"}</small><h3>{item.sourceValueDisplay} <span>→</span> {item.destinationValuesJson.join(", ")}</h3><p>{item.manuallyConfirmed ? "Manually confirmed" : "Automatically inferred"} · {Math.round(item.confidence * 100)}% confidence · used {item.usageCount} time{item.usageCount === 1 ? "" : "s"}</p></div><label><input type="checkbox" checked={item.enabled} disabled={busy === item.id} onChange={() => toggle(item)} /> Enabled</label><button disabled={busy === item.id} onClick={() => remove(item)} aria-label={`Delete ${item.sourceValueDisplay}`}><Trash2 size={15} /></button></article>) : <div className={styles.empty}>No saved mappings match these filters.</div>}</section>
  </main>;
}
