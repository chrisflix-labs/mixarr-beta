"use client";

import { useState } from "react";

function size(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index ? 2 : 0)} ${units[index]}`;
}

export default function StorageDiagnostics({ initial }: { initial: any }) {
  const [data, setData] = useState(initial);
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const reload = async () => setData(await (await fetch("/api/admin/storage", { cache: "no-store" })).json());
  const cleanup = async (action: string, execute = false) => {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/storage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, dryRun: !execute, ...(execute ? { confirm: "DELETE MIXARR MANAGED DATA" } : {}) }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Storage cleanup failed."); setPreview({ action, ...body }); await reload();
    } finally { setBusy(false); }
  };
  const categories = [
    ["Database", data.databaseBytes], ["PostgreSQL WAL", data.databaseWalBytes], ["Cache", data.cacheBytes], ["Artwork", data.artworkBytes],
    ["Temporary", data.temporaryBytes], ["Backups", data.backupBytes], ["Exports", data.exportBytes], ["Logs", data.logBytes],
    ["Scan history", data.scanHistoryBytes], ["Job history", data.jobHistoryBytes], ["AI history", data.aiHistoryBytes],
  ];
  return <div style={{ display: "grid", gap: "1rem" }}>
    <section className="glass-panel" style={{ padding: "1rem" }}><h2>Storage Diagnostics</h2><p>Total managed storage: <strong>{size(data.totalManagedBytes)}</strong> · Filesystem used: <strong>{Number(data.filesystemUsedPercent || 0).toFixed(1)}%</strong> · Free: <strong>{size(data.filesystemFreeBytes)}</strong></p><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: ".75rem" }}>{categories.map(([label, bytes]) => <div key={String(label)}><small>{label}</small><div><strong>{size(Number(bytes))}</strong></div></div>)}</div></section>
    <section className="glass-panel" style={{ padding: "1rem" }}><h3>Configured limits and retention</h3><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(data.configuredLimits, null, 2)}</pre><details><summary>Resolved writable paths</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(data.configuredPaths, null, 2)}</pre></details>{data.unexpectedWritablePaths?.length ? <p role="alert">Unexpected writable paths: {data.unexpectedWritablePaths.map((item: any) => `${item.path} (${size(item.bytes)})`).join(", ")}</p> : <p>No unexpected Mixarr writable paths with data were detected.</p>}</section>
    <section className="glass-panel" style={{ padding: "1rem" }}><h3>Safe cleanup</h3><p>Preview first. Cleanup never traverses symlinks, touches music files, or removes files registered to active jobs.</p><div style={{ display: "flex", flexWrap: "wrap", gap: ".5rem" }}>{[["cleanup_expired","Expired data"],["clear_cache","Expired/oversize cache"],["clear_all_cache","All cache"],["clear_temp","Stale temp"],["prune_jobs","Job history"],["prune_scans","Scan history"],["prune_ai","AI history"],["remove_orphaned_artwork","Orphaned artwork"]].map(([action,label]) => <button key={action} disabled={busy} onClick={() => void cleanup(action)}>{label} preview</button>)}</div>{preview && <div><pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(preview.result, null, 2)}</pre>{preview.result?.dryRun && <button disabled={busy} onClick={() => void cleanup(preview.action, true)}>Confirm and execute this cleanup</button>}</div>}<p>Last cleanup: {data.lastCleanupAt || "Never"} · reclaimed {size(data.lastCleanupReclaimedBytes || 0)}</p></section>
  </div>;
}
