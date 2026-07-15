"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, Search } from "lucide-react";
import styles from "../../library-health.module.css";

export default function MissingRecordsPage({ params, searchParams }: { params: { kind: string }; searchParams: { libraryId?: string; search?: string } }) {
  const kind = ["tracks", "albums", "artists"].includes(params.kind) ? params.kind : "tracks";
  const libraryId = searchParams.libraryId || "";
  const [records, setRecords] = useState<any[]>([]);
  const [search, setSearch] = useState(searchParams.search || "");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const [error, setError] = useState("");
  async function load(nextPage = page) {
    const query = new URLSearchParams({ kind, page: String(nextPage), pageSize: "50" });
    if (libraryId) query.set("libraryId", libraryId); if (search) query.set("search", search);
    const response = await fetch(`/api/library-health/missing-records?${query}`, { cache: "no-store" });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not load missing records");
    setRecords(data.records); setPagination(data.pagination); setPage(nextPage);
  }
  // `load` intentionally captures the submitted search value; scope changes reset to page one.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(1).catch((reason) => setError(reason.message)); }, [kind, libraryId]);
  function submit(event: FormEvent) { event.preventDefault(); void load(1).catch((reason) => setError(reason.message)); }
  const title = `Missing ${kind[0].toUpperCase()}${kind.slice(1)}`;
  return <main className={styles.page}><header className={styles.header}><div><Link className={styles.back} href="/settings/library-health"><ArrowLeft size={15} /> Library Health</Link><h2>{title}</h2><p>Inspect the exact Plex records behind this health count. Records remain non-destructive until Plex restores them or an administrator explicitly acts.</p></div></header>
    {error && <p className={styles.notice}>{error}</p>}
    <section className="glass-panel"><form className={styles.filters} onSubmit={submit}><label>Search<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search missing ${kind}`} /></label><button className={styles.primaryButton}><Search size={15} /> Search</button></form>
    <div className={styles.tableWrap}><table><thead><tr><th>{kind === "tracks" ? "Track" : kind === "albums" ? "Album" : "Artist"}</th>{kind !== "artists" && <th>Artist</th>}<th>Plex key</th><th>Expected tracks</th><th>Active</th><th>Missing</th><th>Unresolved</th><th>File paths</th><th>Last seen</th><th>Reason / actions</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}><td data-label="Name"><strong>{record.title}</strong>{record.library && <small className={styles.trackMeta}>{record.library.name}</small>}</td>{kind !== "artists" && <td data-label="Artist">{record.artist?.title || "Unknown"}</td>}<td data-label="Plex key"><code>{record.plexId || record.ratingKey}</code></td><td data-label="Expected">{record.expectedTrackCount ?? 1}</td><td data-label="Active">{record.activeMixarrTrackCount ?? 0}</td><td data-label="Missing">{record.missingTrackCount ?? 1}</td><td data-label="Unresolved">{record.unresolvedTrackCount ?? (record.syncConflictReason ? 1 : 0)}</td><td data-label="Files">{(record.filePaths || [record.mediaPath]).filter(Boolean).slice(0, 4).map((path: string) => <small className={styles.trackMeta} title={path} key={path}>…{path.slice(-58)}</small>)}</td><td data-label="Last seen">{record.lastSeenAt ? new Date(record.lastSeenAt).toLocaleString() : record.missingSince ? new Date(record.missingSince).toLocaleString() : "Unknown"}</td><td data-label="Reason"><span>{record.reason || record.syncConflictReason || "Not returned by the latest completed Plex scan."}</span><div className={styles.actions}>{kind === "albums" && <Link className={styles.tableAction} href={`/settings/library-health/missing/tracks?libraryId=${encodeURIComponent(libraryId)}&search=${encodeURIComponent(record.title)}`}>View album tracks</Link>}<Link className={styles.tableAction} href={`/settings/library-health/plex-conflicts?libraryId=${encodeURIComponent(libraryId)}&search=${encodeURIComponent(record.title)}`}>View unresolved tracks</Link><Link className={styles.tableAction} href="/settings/library-health">Run targeted repair / refresh Plex metadata</Link></div></td></tr>)}</tbody></table></div>
    {!records.length && <p>No missing {kind} match this filter.</p>}<div className={styles.pagination}><span>{pagination.total.toLocaleString()} records</span><div><button aria-label="Previous page" disabled={page <= 1} onClick={() => void load(page - 1)}><ChevronLeft size={16} /></button><span>Page {page} of {pagination.totalPages}</span><button aria-label="Next page" disabled={page >= pagination.totalPages} onClick={() => void load(page + 1)}><ChevronRight size={16} /></button></div></div></section>
  </main>;
}
