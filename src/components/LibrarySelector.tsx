"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { AlertCircle, CheckCircle2, Library as LibraryIcon, Loader2, RefreshCw, Server } from "lucide-react";
import styles from "@/app/page.module.css";

type PlexLibrary = {
  id: string;
  name: string;
  _count?: { tracks?: number };
  syncLogs?: Array<{ status: string; startedAt: string; endedAt: string | null }>;
};

type PlexServer = { id: string; name: string; libraries?: PlexLibrary[] };

export default function LibrarySelector({ compact = false }: { compact?: boolean }) {
  const [servers, setServers] = useState<PlexServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncingServerId, setSyncingServerId] = useState<string | null>(null);
  const [syncingLibraryId, setSyncingLibraryId] = useState<string | null>(null);

  const fetchServers = useCallback(async () => {
    try {
      const response = await axios.get("/api/plex/servers");
      setServers(response.data.servers || []);
      setError("");
    } catch (caught) {
      console.error("Failed to fetch servers", caught);
      setError("Unable to load Plex servers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchServers(); }, [fetchServers]);

  const syncLibraries = async (serverId: string) => {
    setSyncingServerId(serverId);
    try {
      await axios.post("/api/plex/libraries/sync", { serverId });
      await fetchServers();
    } catch (caught) {
      console.error("Failed to sync libraries", caught);
      setError("Unable to find music libraries on this server.");
    } finally {
      setSyncingServerId(null);
    }
  };

  const startFullSync = async (libraryId: string) => {
    setSyncingLibraryId(libraryId);
    try {
      await axios.post("/api/sync/start", { libraryId });
      window.alert("Background metadata sync started. Live progress is available in Sync & enrichment controls.");
      await fetchServers();
    } catch (caught) {
      console.error("Failed to start metadata sync", caught);
      setError("Unable to start metadata sync.");
    } finally {
      setSyncingLibraryId(null);
    }
  };

  if (loading) return <div className={styles.plexEmpty} aria-busy="true"><Loader2 className="animate-spin" size={17} /> Loading Plex servers…</div>;
  if (error && servers.length === 0) return <div className={styles.plexEmpty} role="status"><AlertCircle size={17} /> <span>{error}</span><button type="button" className={styles.secondaryAction} onClick={() => void fetchServers()}>Try Again</button></div>;
  if (servers.length === 0) return <div className={styles.plexEmpty}><Server size={18} /><span><b>No Plex server configured</b>Connect a Plex server in Settings to begin syncing music.</span></div>;

  return <div className={`${styles.plexServerList} ${compact ? styles.plexServerListCompact : ""}`}>
    {error && <p className={styles.warningText}>{error}</p>}
    {servers.map((server) => <article key={server.id} className={styles.plexServerCard}>
      <header>
        <div><Server size={19} /><span><h3>{server.name}</h3><small><CheckCircle2 size={12} /> Connected</small></span></div>
        <button type="button" onClick={() => void syncLibraries(server.id)} disabled={syncingServerId === server.id} className={styles.secondaryAction}>
          {syncingServerId === server.id ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Find Libraries
        </button>
      </header>
      {server.libraries?.length ? <div className={styles.plexLibraries}>
        {server.libraries.map((library) => {
          const lastSync = library.syncLogs?.[0];
          return <div key={library.id}>
            <LibraryIcon size={17} />
            <span><b>{library.name}</b><small>{(library._count?.tracks || 0).toLocaleString()} active tracks · Last sync {lastSync ? new Date(lastSync.endedAt || lastSync.startedAt).toLocaleString() : "never"}</small></span>
            <button type="button" onClick={() => void startFullSync(library.id)} disabled={syncingLibraryId === library.id} className={styles.primaryAction}>
              {syncingLibraryId === library.id ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Start Sync
            </button>
          </div>;
        })}
      </div> : <p className={styles.plexNoLibraries}>No music libraries found. Use “Find Libraries” to refresh this server.</p>}
    </article>)}
  </div>;
}
