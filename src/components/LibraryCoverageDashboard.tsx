"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BarChart3, CalendarDays, ChevronLeft, ChevronRight, CircleHelp, Download, Gauge, LibraryBig, Loader2, Music2, RefreshCw, Search, Settings2, Sparkles, Users, X } from "lucide-react";
import styles from "./LibraryCoverageDashboard.module.css";

type Tab = "overview" | "tracks" | "artists" | "albums" | "segments" | "settings";
type SummaryPayload = { status: string; snapshot: any; job: any; settings: any; period: string };

const number = (value: unknown, digits = 0) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
const percent = (value: unknown) => `${number(value, 1)}%`;
const activeStatuses = new Set(["queued", "running", "retrying"]);

async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || payload.error || "Request failed");
  return payload.data;
}

export default function LibraryCoverageDashboard() {
  const searchParams = useSearchParams(); const pathname = usePathname(); const router = useRouter();
  const tab = (searchParams.get("tab") || "overview") as Tab;
  const view = searchParams.get("view") || "never_selected";
  const period = searchParams.get("period") || "all_time";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const query = searchParams.get("search") || "";
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [detail, setDetail] = useState<any>(null); const [history, setHistory] = useState<any[]>([]); const [recent, setRecent] = useState<any>(null);
  const [loading, setLoading] = useState(true); const [detailLoading, setDetailLoading] = useState(false); const [error, setError] = useState("");
  const [mixOpen, setMixOpen] = useState(false); const [mixDraft, setMixDraft] = useState<any>(null);
  const activeJobStatus = summary?.job?.status;

  const setFilters = useCallback((changes: Record<string, string | number | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) value == null || value === "" ? next.delete(key) : next.set(key, String(value));
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);

  const loadSummary = useCallback(async () => {
    try {
      const value = await api<SummaryPayload>(`/api/library-coverage/summary?period=${encodeURIComponent(period)}`);
      setSummary(value); setError("");
      return value;
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Unable to load coverage"); return null; }
    finally { setLoading(false); }
  }, [period]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);
  useEffect(() => {
    if (!activeJobStatus || !activeStatuses.has(activeJobStatus)) return;
    const timer = window.setInterval(() => void loadSummary(), 2000);
    return () => window.clearInterval(timer);
  }, [activeJobStatus, loadSummary]);

  useEffect(() => {
    if (tab === "overview") {
      Promise.all([api<any[]>("/api/library-coverage/history?limit=30"), api("/api/library-coverage/recently-added?days=90")]).then(([h, r]) => { setHistory(h); setRecent(r); }).catch(() => undefined);
      return;
    }
    if (tab === "settings") return;
    setDetailLoading(true);
    const base = new URLSearchParams({ page: String(page), pageSize: "50" });
    if (query) base.set("search", query);
    for (const key of ["genre", "mood", "decade"] as const) {
      const value = searchParams.get(key);
      if (value) base.set(key, value);
    }
    let endpoint = `/api/library-coverage/tracks?${base}&view=${encodeURIComponent(view)}`;
    if (tab === "artists") endpoint = `/api/library-coverage/artists?${base}&usage=${view === "never_selected" ? "never" : view}`;
    if (tab === "albums") endpoint = `/api/library-coverage/albums?${base}&usage=${view === "never_selected" ? "never" : view}`;
    if (tab === "segments") endpoint = `/api/library-coverage/segments?${base}&dimension=${encodeURIComponent(searchParams.get("dimension") || "genre_primary")}`;
    api(endpoint).then(setDetail).catch((loadError) => setError(loadError.message)).finally(() => setDetailLoading(false));
  }, [page, query, searchParams, tab, view]);

  async function recalculate() {
    setError("");
    try { await api("/api/library-coverage/recalculate", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); await loadSummary(); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Unable to start calculation"); }
  }

  const snapshot = summary?.snapshot;
  const segmentGroups = useMemo(() => {
    const all = snapshot?.segments || [];
    return { genres: all.filter((item: any) => item.dimension === "genre_primary").slice(0, 8), moods: all.filter((item: any) => item.dimension === "mood_primary").slice(0, 8), decades: all.filter((item: any) => item.dimension === "decade").sort((a: any, b: any) => a.segmentKey.localeCompare(b.segmentKey)) };
  }, [snapshot]);

  return (
    <main className={styles.wrapper}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}><LibraryBig size={15} /> Rotation intelligence</p><h2>Library Coverage</h2><p>Understand which parts of your Plex music library Mixarr uses, which tracks are being overlooked, and where strong discovery opportunities exist.</p></div>
        <div className={styles.headerActions}><button className={styles.secondaryButton} onClick={() => void recalculate()} disabled={activeStatuses.has(summary?.job?.status)}>{activeStatuses.has(summary?.job?.status) ? <Loader2 className={styles.spin} size={16} /> : <RefreshCw size={16} />} Recalculate</button><button className={styles.primaryButton} onClick={() => setMixOpen(true)}><Sparkles size={16} /> Build a neglected mix</button></div>
      </header>

      {error && <div className={styles.error} role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss error"><X size={15} /></button></div>}
      {summary?.job && activeStatuses.has(summary.job.status) && <JobProgress job={summary.job} onCancel={async () => { await api(`/api/library-coverage/jobs/${summary.job.id}/cancel`, { method: "POST" }); await loadSummary(); }} />}

      <nav className={styles.tabs} aria-label="Library coverage sections">
        {(["overview", "tracks", "artists", "albums", "segments", "settings"] as Tab[]).map((item) => <button key={item} aria-current={tab === item ? "page" : undefined} onClick={() => setFilters({ tab: item, page: null, search: null })}>{item[0].toUpperCase() + item.slice(1)}</button>)}
      </nav>

      {loading ? <Skeleton /> : !snapshot ? <EmptyState onCalculate={recalculate} running={activeStatuses.has(summary?.job?.status)} /> : tab === "overview" ? (
        <Overview snapshot={snapshot} settings={summary?.settings} period={period} setFilters={setFilters} groups={segmentGroups} history={history} recent={recent} />
      ) : tab === "settings" ? <CoverageSettings initial={summary!.settings} onSaved={(settings: any) => setSummary((current) => current ? { ...current, settings } : current)} /> : (
        <DetailView tab={tab} view={view} query={query} detail={detail} loading={detailLoading} page={page} searchParams={searchParams} setFilters={setFilters} />
      )}
      {mixOpen && <NeglectedMixDialog onClose={() => { setMixOpen(false); setMixDraft(null); }} draft={mixDraft} onDraft={setMixDraft} />}
    </main>
  );
}

function Overview({ snapshot, settings, period, setFilters, groups, history, recent }: any) {
  const cards = [
    ["Coverage", percent(snapshot.coveragePercentage), `${number(snapshot.usedTracks)} of ${number(snapshot.analyzedTracks)} analyzed`, "tracks", "all", BarChart3],
    ["Rotation fairness", `${number(snapshot.rotationFairnessScore, 0)}/100`, fairnessLabel(snapshot.rotationFairnessScore), "tracks", "overused", Gauge],
    ["Never selected", number(snapshot.neverSelectedTracks), "Eligible analyzed tracks", "tracks", "never_selected", Music2],
    ["Strong opportunities", number(snapshot.highConfidenceNeglected), `Score ≥ ${number(settings.minimumOpportunityScore)}`, "tracks", "opportunities", Sparkles],
    ["Overused", number(snapshot.overusedTracks), `Score ≥ ${number(settings.overuseThreshold)}`, "tracks", "overused", RefreshCw],
    ["Unused artists", number(snapshot.eligibleArtists - snapshot.usedArtists), `${percent(snapshot.artistCoverage)} artist coverage`, "artists", "never_selected", Users],
    ["Unused albums", number(snapshot.eligibleAlbums - snapshot.usedAlbums), `${percent(snapshot.albumCoverage)} album coverage`, "albums", "never_selected", LibraryBig],
    ["Recently added", percent(snapshot.recentlyAddedCoverage), `${number(recent?.selectedTracks)} selected in 90 days`, "tracks", "opportunities", CalendarDays],
  ];
  return <div className={styles.stack}>
    {snapshot.partialHistory && <div className={styles.notice}><CircleHelp size={17} /><span><strong>Partial historical data.</strong> Some older generated playlists do not have retained v2 history, so all-time totals may be understated.</span></div>}
    <section className={styles.periodRow}><span>Coverage period</span>{[["all_time", "All time"], ["active", "Active"], ["30d", "30 days"], ["90d", "90 days"], ["12m", "12 months"]].map(([key, label]) => <button key={key} data-active={period === key} onClick={() => setFilters({ period: key })}>{label}</button>)}</section>
    <section className={styles.cards}>{cards.map(([label, value, note, tab, view, Icon]: any) => <button className={styles.metricCard} key={label} onClick={() => setFilters({ tab, view, page: null })}><span className={styles.metricIcon}><Icon size={18} /></span><span className={styles.metricLabel}>{label}<CircleHelp size={13} aria-label={`${label} explanation`} /></span><strong>{value}</strong><small>{note}</small></button>)}</section>
    <section className={styles.twoColumn}>
      <article className={`glass-panel ${styles.panel}`}><div className={styles.panelHeader}><div><h3>Used versus unused</h3><p>Eligible analyzed tracks, all time</p></div></div><div className={styles.donutWrap}><div className={styles.donut} style={{ "--coverage": `${Math.min(100, snapshot.coveragePercentage)}%` } as any}><span><strong>{percent(snapshot.coveragePercentage)}</strong><small>covered</small></span></div><dl className={styles.legend}><div><dt>Historically selected</dt><dd>{number(snapshot.usedTracks)}</dd></div><div><dt>Never selected</dt><dd>{number(snapshot.neverSelectedTracks)}</dd></div><div><dt>Active now</dt><dd>{number(snapshot.activeTracks)}</dd></div><div><dt>Excluded</dt><dd>{number(snapshot.excludedTracks)}</dd></div></dl></div></article>
      <article className={`glass-panel ${styles.panel}`}><div className={styles.panelHeader}><div><h3>Coverage trend</h3><p>Stored snapshots; unchanged values are deduplicated</p></div></div><TrendChart history={history} /></article>
    </section>
    <section className={styles.chartGrid}><SegmentChart title="Genre coverage" items={groups.genres} onClick={(item: any) => setFilters({ tab: "tracks", view: "opportunities", genre: item.label, mood: null, decade: null, page: null })} /><SegmentChart title="Mood coverage" items={groups.moods} onClick={(item: any) => setFilters({ tab: "tracks", view: "opportunities", genre: null, mood: item.label, decade: null, page: null })} /><SegmentChart title="Decade coverage" items={groups.decades} onClick={(item: any) => setFilters({ tab: "tracks", view: "opportunities", genre: null, mood: null, decade: item.segmentKey, page: null })} /></section>
    <section className={`glass-panel ${styles.explanation}`}><CircleHelp size={20} /><div><h3>How these metrics work</h3><p><strong>Coverage</strong> is unique eligible, analyzed tracks selected by Smart Mix divided by all eligible analyzed tracks. Manual/imported use is excluded unless enabled. <strong>Fairness</strong> measures quality-weighted concentration; it does not reward random low-quality choices. Neglect bonuses are applied only after normal eligibility and quality checks, and coverage-aware scoring is {settings.coverageAwareScoringEnabled ? "enabled with a bounded influence" : "disabled"}.</p></div></section>
  </div>;
}

function DetailView({ tab, view, query, detail, loading, page, searchParams, setFilters }: any) {
  const dimension = searchParams.get("dimension") || "genre_primary";
  const exportParams = new URLSearchParams(searchParams.toString());
  exportParams.set("type", tab === "tracks" ? view.replace("_", "-") : tab);
  exportParams.set("format", "csv");
  exportParams.delete("tab"); exportParams.delete("page"); exportParams.delete("period");
  return <section className={styles.stack}>
    <div className={styles.toolbar}><div className={styles.segmented}>{tab === "tracks" && [["never_selected", "Never selected"], ["opportunities", "Opportunities"], ["overused", "Overused"], ["all", "All"]].map(([key, label]) => <button key={key} data-active={view === key} onClick={() => setFilters({ view: key, page: null })}>{label}</button>)}{tab === "artists" && [["never_selected", "Never selected"], ["underused", "Underused"], ["overused", "Overused"], ["all", "All"]].map(([key, label]) => <button key={key} data-active={view === key} onClick={() => setFilters({ view: key, page: null })}>{label}</button>)}{tab === "albums" && [["never_selected", "Unused"], ["partial", "Partial"], ["heavy", "Heavily used"], ["all", "All"]].map(([key, label]) => <button key={key} data-active={view === key} onClick={() => setFilters({ view: key, page: null })}>{label}</button>)}{tab === "segments" && [["genre_primary", "Genres"], ["mood_primary", "Moods"], ["decade", "Decades"], ["library", "Libraries"]].map(([key, label]) => <button key={key} data-active={dimension === key} onClick={() => setFilters({ dimension: key, page: null })}>{label}</button>)}</div><label className={styles.search}><Search size={16} /><input defaultValue={query} placeholder={`Search ${tab}`} onKeyDown={(event) => { if (event.key === "Enter") setFilters({ search: event.currentTarget.value, page: null }); }} /></label><a className={styles.iconButton} href={`/api/library-coverage/export?${exportParams}`} title="Export active view as CSV"><Download size={17} /></a></div>
    <div className={`glass-panel ${styles.tablePanel}`}>{loading ? <div className={styles.tableLoading}><Loader2 className={styles.spin} /> Loading intelligence…</div> : <CoverageTable tab={tab} data={detail} onDrill={(changes: any) => setFilters(changes)} />}</div>
    {detail && <Pagination page={page} totalPages={detail.totalPages} onPage={(next: number) => setFilters({ page: next })} />}
  </section>;
}

function CoverageTable({ tab, data, onDrill }: any) {
  const drillSegment = (row: any) => onDrill({
    tab: "tracks", view: "opportunities", page: null,
    genre: row.dimension.startsWith("genre") ? row.label : null,
    mood: row.dimension.startsWith("mood") ? row.label : null,
    decade: row.dimension === "decade" ? row.segmentKey : null,
  });
  if (!data?.items?.length) return <div className={styles.emptySmall}><Music2 size={28} /><h3>No matching coverage records</h3><p>Try clearing filters or recalculate coverage after generating Smart Mix playlists.</p></div>;
  if (tab === "tracks") return <div className={styles.tableScroll}><table><thead><tr><th>Track</th><th>Year / tags</th><th>Metadata</th><th>Usage</th><th>Opportunity</th><th>Why</th></tr></thead><tbody>{data.items.map((row: any) => <tr key={row.id}><td><Link href={`/tracks/${row.track.id}`}><strong>{row.track.title}</strong></Link><small>{row.track.artist.title} · {row.track.album.title}</small></td><td>{row.track.album.year || "Unknown"}<small>{row.track.tags.filter((t: any) => t.type === "genre" || t.type === "mood").slice(0, 3).map((t: any) => t.name).join(" · ") || "No genre/mood"}</small></td><td>{percent(row.metadataConfidence)}<small>Audio {percent(row.audioFeatureConfidence)}</small></td><td>{number(row.selectionCount)}<small>{number(row.uniquePlaylistCount)} playlists · {number(row.generationConsiderationCount)} considered</small></td><td><Score value={row.opportunityScore} /><small>Overuse {number(row.overuseScore, 0)}</small></td><td><span className={styles.reason}>{row.reasonNeverSelected || (row.explanationJson as any)?.overuse?.[0] || "Historically selected"}</span></td></tr>)}</tbody></table></div>;
  if (tab === "artists") return <div className={styles.tableScroll}><table><thead><tr><th>Artist</th><th>Eligible</th><th>Analyzed</th><th>Selected</th><th>Coverage</th><th>Best candidate</th><th>Action</th></tr></thead><tbody>{data.items.map((row: any) => <tr key={row.id}><td><strong>{row.title}</strong></td><td>{number(row.eligibleTrackCount)}</td><td>{number(row.analyzedTrackCount)}</td><td>{number(row.selectedTrackCount)}</td><td>{percent(row.coveragePercentage)}</td><td><Score value={row.bestCandidateScore} /></td><td><button className={styles.textButton} onClick={() => onDrill({ tab: "tracks", view: "opportunities", search: row.title, page: null })}>Build related mix</button></td></tr>)}</tbody></table></div>;
  if (tab === "albums") return <div className={styles.tableScroll}><table><thead><tr><th>Album</th><th>Year</th><th>Eligible</th><th>Analyzed</th><th>Selected</th><th>Coverage</th><th>Best candidate</th></tr></thead><tbody>{data.items.map((row: any) => <tr key={row.id}><td><strong>{row.title}</strong><small>{row.artist}</small></td><td>{row.year || "Unknown"}</td><td>{number(row.eligibleTrackCount)}</td><td>{number(row.analyzedTrackCount)}</td><td>{number(row.selectedTrackCount)}</td><td>{percent(row.coveragePercentage)}</td><td><Score value={row.bestCandidateScore} /></td></tr>)}</tbody></table></div>;
  return <div className={styles.tableScroll}><table><thead><tr><th>Segment</th><th>Eligible</th><th>Selected</th><th>Coverage</th><th>Appearances</th><th>Opportunities</th><th>Overused</th></tr></thead><tbody>{data.items.map((row: any) => <tr key={row.id}><td><button className={styles.textButton} onClick={() => drillSegment(row)}><strong>{row.label}</strong></button></td><td>{number(row.eligibleTracks)}</td><td>{number(row.selectedTracks)}</td><td>{percent(row.coveragePercentage)}</td><td>{number(row.playlistAppearances)}</td><td>{number(row.opportunityCount)}</td><td>{number(row.overuseCount)}</td></tr>)}</tbody></table></div>;
}

function CoverageSettings({ initial, onSaved }: any) {
  const [form, setForm] = useState(initial); const [status, setStatus] = useState("");
  const toggle = (key: string) => setForm((value: any) => {
    const enabled = !value[key];
    return { ...value, [key]: enabled, ...(key === "coverageAwareScoringEnabled" && enabled && value.coverageInfluenceLevel === "disabled" ? { coverageInfluenceLevel: "low" } : {}) };
  });
  async function save() { setStatus("Saving…"); try { const saved = await api("/api/library-coverage/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }); setForm(saved); onSaved(saved); setStatus("Saved"); } catch (error) { setStatus(error instanceof Error ? error.message : "Save failed"); } }
  return <section className={`glass-panel ${styles.settingsPanel}`}><div className={styles.panelHeader}><div><h3>Coverage &amp; rotation settings</h3><p>Conservative defaults preserve existing playlist results. Coverage-aware scoring remains disabled until enabled here.</p></div></div><div className={styles.settingsGrid}>{[["snapshotsEnabled", "Enable coverage snapshots"], ["includeManualTracks", "Include manually added tracks"], ["includeImportedPlaylists", "Include imported Plex playlists"], ["includeDeletedPlaylistHistory", "Include deleted playlist history"], ["excludeExplicitDislikes", "Exclude explicit dislikes"], ["excludeNeverRecommend", "Exclude never recommend"], ["excludeMissingPlexTracks", "Exclude missing Plex tracks"], ["excludeDuplicateVersions", "Exclude duplicate versions"], ["allowLiveTracks", "Allow live tracks"], ["allowCompilations", "Allow compilations"], ["coverageAwareScoringEnabled", "Enable coverage-aware Smart Mix scoring"]].map(([key, label]) => <label className={styles.toggle} key={key}><input type="checkbox" checked={Boolean(form[key])} onChange={() => toggle(key)} /><span>{label}</span></label>)}</div><div className={styles.fieldGrid}><NumberField label="Metadata confidence" value={form.minimumMetadataConfidence * 100} suffix="%" onChange={(value: number) => setForm({ ...form, minimumMetadataConfidence: value / 100 })} /><NumberField label="Audio confidence" value={form.minimumAudioFeatureConfidence * 100} suffix="%" onChange={(value: number) => setForm({ ...form, minimumAudioFeatureConfidence: value / 100 })} /><NumberField label="Opportunity threshold" value={form.minimumOpportunityScore} onChange={(value: number) => setForm({ ...form, minimumOpportunityScore: value })} /><NumberField label="Overuse threshold" value={form.overuseThreshold} onChange={(value: number) => setForm({ ...form, overuseThreshold: value })} /><NumberField label="Cooldown" value={form.selectionCooldownDays} suffix=" days" onChange={(value: number) => setForm({ ...form, selectionCooldownDays: value })} /><NumberField label="Maximum influence" value={form.maximumRotationInfluence} suffix=" pts" onChange={(value: number) => setForm({ ...form, maximumRotationInfluence: value })} /><label className={styles.numberField}><span>Influence level</span><span><select value={form.coverageInfluenceLevel} disabled={!form.coverageAwareScoringEnabled} onChange={(event) => setForm({ ...form, coverageInfluenceLevel: event.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="custom">Custom</option></select></span></label></div><div className={styles.settingsActions}><button className={styles.primaryButton} onClick={() => void save()}>Save settings</button><button className={styles.dangerButton} onClick={async () => { if (!window.confirm("Reset calculated coverage statistics? Playlist history and personalization data will be preserved.")) return; const saved = await api("/api/library-coverage/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resetCalculatedStatistics: true }) }); onSaved(saved); setStatus("Calculated statistics reset"); }}>Reset calculated statistics</button><span role="status">{status}</span></div></section>;
}

function NumberField({ label, value, suffix, onChange }: any) { return <label className={styles.numberField}><span>{label}</span><span><input type="number" value={number(value, 0).replaceAll(",", "")} onChange={(event) => onChange(Number(event.target.value))} />{suffix}</span></label>; }

function NeglectedMixDialog({ onClose, draft, onDraft }: any) {
  const [preset, setPreset] = useState("safe_discovery"); const [name, setName] = useState("Safe Discovery Mix"); const [count, setCount] = useState(50); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  async function preview() { setLoading(true); setError(""); try { onDraft(await api("/api/library-coverage/build-mix", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preset, playlistName: name, targetTrackCount: count, neverSelectedOnly: true }) })); } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Preview failed"); } finally { setLoading(false); } }
  return <div className={styles.modalLayer} role="dialog" aria-modal="true" aria-labelledby="neglected-title"><button className={styles.backdrop} onClick={onClose} aria-label="Close mix builder" /><section className={styles.modal}><div className={styles.modalHeader}><div><p className={styles.eyebrow}><Sparkles size={14} /> Guided Smart Mix workflow</p><h2 id="neglected-title">Build from neglected tracks</h2></div><button className={styles.iconButton} onClick={onClose} aria-label="Close"><X /></button></div>{!draft ? <><p>Neglect is a bounded bonus after normal eligibility, metadata, identity, personalization, transition, and quality checks.</p><label className={styles.modalField}>Mode<select value={preset} onChange={(event) => setPreset(event.target.value)}><option value="safe_discovery">Safe Discovery</option><option value="balanced">Balanced Neglected Mix</option><option value="deep_library">Deep Library Dive</option><option value="recently_added">Recently Added Opportunities</option><option value="underused_quality">Underused High Quality</option></select></label><label className={styles.modalField}>Playlist name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label className={styles.modalField}>Target tracks<input type="number" min="5" max="250" value={count} onChange={(event) => setCount(Number(event.target.value))} /></label>{error && <p className={styles.error}>{error}</p>}<button className={styles.primaryButton} onClick={() => void preview()} disabled={loading}>{loading ? <Loader2 className={styles.spin} /> : <Sparkles />} Preview candidates</button></> : <><div className={styles.draftSummary}><strong>{draft.configuration.playlistName}</strong><span>{draft.tracks.length} of {draft.configuration.targetTrackCount} conservative candidates</span></div><div className={styles.draftTracks}>{draft.tracks.slice(0, 12).map((track: any) => <div key={track.id}><span><strong>{track.title}</strong><small>{track.artist.title} · {track.album.title}</small></span><Score value={track.coverage.opportunityScore} /></div>)}</div><p className={styles.notice}><CircleHelp size={16} /> Preview only. Nothing has been written to Plex.</p><div className={styles.modalActions}><button className={styles.secondaryButton} onClick={() => onDraft(null)}>Adjust</button><Link className={styles.primaryButton} href={`${draft.handoff.route}?coverageDraft=true&preset=${preset}`}>Continue in Smart Builder</Link></div></>}</section></div>;
}

function JobProgress({ job, onCancel }: any) { return <section className={styles.job} aria-live="polite"><div><Loader2 className={styles.spin} size={18} /><span><strong>{job.currentStage}</strong><small>{number(job.processedTracks)} / {number(job.totalTracks)} tracks</small></span></div><div className={styles.progress}><span style={{ width: `${job.percentage}%` }} /></div><strong>{number(job.percentage, 0)}%</strong><button onClick={() => void onCancel()}>Cancel</button></section>; }
function Score({ value }: { value: number }) { const score = Number(value || 0); return <span className={styles.score} data-level={score >= 75 ? "high" : score >= 50 ? "medium" : "low"}>{number(score, 0)}</span>; }
function fairnessLabel(value: number) { return value < 40 ? "Highly concentrated" : value < 60 ? "Limited rotation" : value < 75 ? "Balanced" : value < 90 ? "Broad rotation" : "Very broad rotation"; }
function SegmentChart({ title, items, onClick }: any) { const max = Math.max(1, ...items.map((item: any) => item.eligibleTracks)); return <article className={`glass-panel ${styles.panel}`}><div className={styles.panelHeader}><div><h3>{title}</h3><p>Coverage and eligible tracks</p></div></div><div className={styles.bars}>{items.length ? items.map((item: any) => <button key={item.id} onClick={() => onClick(item)} title={`${item.label}: ${percent(item.coveragePercentage)} coverage`}><span>{item.label}</span><i><b style={{ width: `${item.eligibleTracks / max * 100}%` }}><em style={{ width: `${item.coveragePercentage}%` }} /></b></i><strong>{percent(item.coveragePercentage)}</strong></button>) : <p>No segment data yet.</p>}</div></article>; }
function TrendChart({ history }: any) { const ordered = [...history].reverse(); const max = Math.max(1, ...ordered.map((item: any) => item.coveragePercentage)); return <div className={styles.trend} role="img" aria-label="Library coverage trend">{ordered.length ? ordered.map((item: any) => <span key={item.id} style={{ height: `${Math.max(5, item.coveragePercentage / max * 100)}%` }} title={`${new Date(item.createdAt).toLocaleDateString()}: ${percent(item.coveragePercentage)}`} />) : <p>No historical snapshots yet.</p>}</div>; }
function Pagination({ page, totalPages, onPage }: any) { return <div className={styles.pagination}><button disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={16} /> Previous</button><span>Page {number(page)} of {number(totalPages)}</span><button disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next <ChevronRight size={16} /></button></div>; }
function Skeleton() { return <div className={styles.skeleton}>{Array.from({ length: 8 }, (_, index) => <span key={index} />)}</div>; }
function EmptyState({ onCalculate, running }: any) { return <section className={`glass-panel ${styles.empty}`}><LibraryBig size={42} /><h3>Coverage intelligence is ready to calculate</h3><p>The first backfill runs in the background and does not change existing playlists. Mixarr will aggregate retained Smart Mix history in bounded chunks.</p><button className={styles.primaryButton} onClick={() => void onCalculate()} disabled={running}>{running ? <Loader2 className={styles.spin} /> : <RefreshCw />} Calculate library coverage</button></section>; }


