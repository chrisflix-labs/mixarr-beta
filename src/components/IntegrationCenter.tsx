"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import styles from "@/app/settings/integrations/integrations.module.css";
import { ClipboardCopyError, copyTextToClipboard } from "@/lib/clipboard";
import { formatPlexAccountLabel, type NormalizedPlexUser } from "@/lib/plexUsers";

const API_TOKEN_SCOPES = ["status.read","health.read","playlists.read","collections.read","automations.read","activity.read","integrations.read","widget.read","home_assistant.read","metrics.read","recipes.read","webhooks.manage","integrations.manage"] as const;
const INTEGRATION_EVENTS = ["playlist.created","playlist.updated","playlist.health_changed","playlist.reconciliation_required","playlist.reconciled","playlist.sync_failed","playlist.deleted","collection.created","collection.updated","collection.sync_failed","recipe.imported","recipe.shared","smart_action.pending","smart_action.completed","smart_action.failed","experiment.completed","automation.failed","automation.recovered","plex.unavailable","plex.recovered","plex.failover_activated","mount.unavailable","mount.recovered","integration.failed","integration.recovered"] as const;

class ApiError extends Error {
  constructor(message: string, public code: string | null, public status: number) { super(message); }
}
async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  let data: any = {};
  try { data = await response.json(); } catch { /* Use a safe generic error below. */ }
  if (!response.ok) throw new ApiError(data.error || "Request failed.", data.code || null, response.status);
  return data;
}
const date = (value: any) => value ? new Date(value).toLocaleString() : "Never";
const stateTone = (value: string) => /AVAILABLE|HEALTHY|PASSED|SUCCEEDED/.test(value) ? "ok" : /DISABLED|UNKNOWN/.test(value) ? "muted" : "warn";
type DiscoveredAccount = NormalizedPlexUser & { serverId: string; serverName: string };
type DiscoveryState = { status: "idle" | "loading" | "success" | "empty" | "not_configured" | "error"; reason: string; warnings: string[] };

export default function IntegrationCenter({ initial }: { initial: any }) {
  const [data, setData] = useState(initial); const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(""); const [newToken, setNewToken] = useState("");
  const [plexAccounts, setPlexAccounts] = useState<DiscoveredAccount[]>([]);
  const [plexDiscovery, setPlexDiscovery] = useState<DiscoveryState>({ status: "idle", reason: "", warnings: [] });
  const discoveryStarted = useRef(false);
  const [tokenForm, setTokenForm] = useState({ name: "Dashboard", scopes: ["status.read", "widget.read"] as string[] });
  const [webhook, setWebhook] = useState({ displayName: "Automation webhook", destinationUrl: "", events: ["playlist.created"] as string[], enabled: true });
  const integrationMap = useMemo(() => new Map(data.integrations.map((row: any) => [row.key, row])), [data.integrations]);
  const loadPlexAccounts = useCallback(async (refresh = false) => {
    if (!initial.servers.length) {
      setPlexDiscovery({ status: "not_configured", reason: "Configure and connect Plex before mapping users.", warnings: [] });
      return;
    }
    setPlexDiscovery((current) => ({ ...current, status: "loading", reason: "" }));
    if (refresh) { setMessage(""); setError(""); }
    try {
      const result = await api("/api/integrations/plex/users");
      const accounts = Array.isArray(result.users) ? result.users : [];
      setPlexAccounts(accounts);
      setPlexDiscovery({
        status: accounts.length ? "success" : "empty",
        reason: "",
        warnings: Array.isArray(result.warnings) ? result.warnings.map((warning: any) => String(warning.message || "")).filter(Boolean) : [],
      });
      if (refresh) setMessage(`Plex accounts refreshed. ${accounts.length} account${accounts.length === 1 ? "" : "s"} available.`);
    } catch (requestError) {
      const reason = requestError instanceof Error ? requestError.message : "The Plex account request failed.";
      const notConfigured = requestError instanceof ApiError && requestError.code === "PLEX_NOT_CONFIGURED";
      setPlexDiscovery({ status: notConfigured ? "not_configured" : "error", reason, warnings: [] });
      if (refresh) setError(notConfigured ? reason : `Unable to refresh Plex accounts. ${reason}`);
    }
  }, [initial.servers.length]);
  useEffect(() => {
    if (discoveryStarted.current) return;
    discoveryStarted.current = true;
    void loadPlexAccounts();
  }, [loadPlexAccounts]);
  async function act(key: string, fn: () => Promise<any>, success: string) { setBusy(key); setError(""); setMessage(""); try { const result = await fn(); setMessage(success); return result; } catch (e) { setError(e instanceof Error ? e.message : "Request failed."); } finally { setBusy(""); } }
  async function testServer(server: any) { const result = await act(`plex:${server.id}`, () => api(`/api/integrations/plex/servers/${server.id}/test`, { method: "POST" }), `Finished Plex checks for ${server.name}.`); if (result) setData((current: any) => ({ ...current, tests: [{ id: crypto.randomUUID(), testKey: `plex.connection:${server.name}`, status: result.status, safe: true, durationMs: result.durationMs, message: result.results.map((row: any) => `${row.label}: ${row.status}`).join(" · "), createdAt: new Date() }, ...current.tests].slice(0, 25) })); }
  async function mapUser(user: any, server: any, plexUserId: string) {
    const account = plexAccounts.find((item) => item.serverId === server.id && item.id === plexUserId);
    if (!account) return;
    const result = await act(`map:${user.id}:${server.id}`, () => api("/api/integrations/plex/users", { method: "PUT", body: JSON.stringify({ userId: user.id, serverId: server.id, plexUserId: account.id }) }), `Mapped ${user.username} to ${account.title}.`);
    if (result?.mapping) setData((current: any) => ({ ...current, users: current.users.map((item: any) => item.id !== user.id ? item : { ...item, plexUserMappings: [...item.plexUserMappings.filter((mapping: any) => mapping.serverId !== server.id), result.mapping] }) }));
  }
  async function unmapUser(user: any, server: any) {
    const result = await act(`unmap:${user.id}:${server.id}`, () => api("/api/integrations/plex/users", { method: "DELETE", body: JSON.stringify({ userId: user.id, serverId: server.id }) }), `Removed the Plex mapping for ${user.username}.`);
    if (result) setData((current: any) => ({ ...current, users: current.users.map((item: any) => item.id !== user.id ? item : { ...item, plexUserMappings: item.plexUserMappings.filter((mapping: any) => mapping.serverId !== server.id) }) }));
  }
  async function createToken() { const result = await act("token", () => api("/api/integrations/tokens", { method: "POST", body: JSON.stringify(tokenForm) }), "Scoped token created. Copy it now; it will not be shown again."); if (result) { setNewToken(result.token); setData((current: any) => ({ ...current, tokens: [result, ...current.tokens] })); } }
  // The revealed token is shown exactly once, so a silent clipboard failure would
  // lose it permanently. Report the outcome truthfully and keep the value on
  // screen for manual selection when the browser denies clipboard access.
  async function copyToken() {
    setMessage(""); setError("");
    try { await copyTextToClipboard(newToken); setMessage("Scoped token copied to clipboard."); }
    catch (caught) { setError(caught instanceof ClipboardCopyError ? `${caught.message} Select the token above and copy it manually before leaving this page.` : "The token could not be copied. Select it above and copy it manually before leaving this page."); }
  }
  async function revokeToken(id: string) { const result = await act(`revoke:${id}`, () => api(`/api/integrations/tokens/${id}`, { method: "DELETE" }), "Token revoked."); if (result) setData((current: any) => ({ ...current, tokens: current.tokens.map((token: any) => token.id === id ? { ...token, enabled: false, revokedAt: new Date() } : token) })); }
  async function createWebhook() { const result = await act("webhook", () => api("/api/integrations/webhooks", { method: "POST", body: JSON.stringify(webhook) }), "Signed webhook created."); if (result) setData((current: any) => ({ ...current, endpoints: [result.endpoint, ...current.endpoints] })); }
  async function configure(key: string, displayName: string) { const current: any = integrationMap.get(key); const url = window.prompt(`${displayName} URL (leave blank to keep the saved secret)`, ""); if (url === null) return; const apiKey = key === "discord" ? "" : window.prompt(`${displayName} API key (leave blank if not used)`, "") || ""; const result = await act(`config:${key}`, () => api(`/api/integrations/configuration/${key}`, { method: "PUT", body: JSON.stringify({ displayName, enabled: true, configuration: current?.configurationJson || {}, secrets: url ? { url, webhookUrl: url, ...(apiKey ? { apiKey } : {}) } : undefined }) }), `${displayName} configuration saved.`); if (result) setData((state: any) => ({ ...state, integrations: [...state.integrations.filter((item: any) => item.key !== key), result.integration] })); }
  return <main className={styles.wrapper}>
    <header className={styles.header}><div><p className={styles.eyebrow}>Mixarr v2.3.8</p><h1>Media Ecosystem Integrations</h1><p>Configure, test, and monitor Plex, notifications, dashboard APIs, metrics, and storage safety.</p></div><button onClick={() => void act("safe", () => api("/api/integrations/tests/safe", { method: "POST" }), "Safe integration tests completed.")} disabled={!!busy}>{busy === "safe" ? "Running…" : "Run safe tests"}</button></header>
    {(message || error) && <p className={error ? styles.error : styles.success}>{error || message}</p>}
    <nav className={styles.jump}>{["plex","users","services","webhooks","tokens","diagnostics"].map((id) => <a key={id} href={`#${id}`}>{id}</a>)}</nav>
    <section id="plex"><h2>Plex servers, libraries, and collections</h2><div className={styles.grid}>{data.servers.map((server: any) => <article className={styles.card} key={server.id}><div className={styles.cardHeader}><div><h3>{server.name}</h3><p>{server.role.toLowerCase()} · priority {server.priority}</p></div><span data-tone={stateTone(server.availabilityState)}>{server.availabilityState}</span></div><dl><div><dt>Latency</dt><dd>{server.responseLatencyMs ? `${server.responseLatencyMs} ms` : "—"}</dd></div><div><dt>Failures</dt><dd>{server.failureCount}</dd></div><div><dt>Last success</dt><dd>{date(server.lastSuccessAt)}</dd></div><div><dt>Write failover</dt><dd>{server.failoverWritePolicy === "ALLOW_WRITES" ? "Allowed" : "Read only"}</dd></div></dl><div className={styles.libraryList}>{server.libraries.filter((library: any) => library.type === "artist").map((library: any) => <small key={library.id}>{library.name} · {library.scanState}{library.destructiveSyncBlockedUntil ? " · safety grace active" : ""}</small>)}</div>{server.lastFailureReason && <p className={styles.warning}>{server.lastFailureReason}</p>}<button onClick={() => void testServer(server)} disabled={!!busy}>{busy === `plex:${server.id}` ? "Testing…" : "Test connection"}</button></article>)}</div><div className={styles.subpanel}><h3>Tracked Plex collections</h3>{data.collectionStates.length ? data.collectionStates.map((row: any) => <div className={styles.row} key={row.id}><span><strong>{row.name}</strong><small>{row.itemCount} items · {row.managedByMixarr ? "synchronized" : "one-time"}</small></span><em data-tone={stateTone(row.available ? "AVAILABLE" : "UNAVAILABLE")}>{row.available ? "Available" : "Unavailable"}</em></div>) : <p>No collections have been imported or exported yet.</p>}</div></section>
    <section id="users">
      <div className={styles.sectionHeading}>
        <div><h2>Plex user mapping</h2><p>Map each Mixarr user to a stable Plex account on each connected server.</p></div>
        <button type="button" onClick={() => void loadPlexAccounts(true)} disabled={plexDiscovery.status === "loading" || !!busy}>
          {plexDiscovery.status === "loading" ? "Loading Plex accounts…" : "Refresh Plex accounts"}
        </button>
      </div>
      <div className={styles.subpanel}>
        {plexDiscovery.status === "loading" && <p className={styles.discoveryStatus}>Loading Plex accounts…</p>}
        {plexDiscovery.status === "empty" && <p className={styles.discoveryStatus}>No Plex accounts were returned by the connected Plex server.</p>}
        {plexDiscovery.status === "not_configured" && <p className={styles.discoveryStatus}>Configure and connect Plex before mapping users.</p>}
        {plexDiscovery.status === "error" && <div className={styles.discoveryError}><p><strong>Unable to load Plex accounts.</strong>{plexDiscovery.reason ? ` ${plexDiscovery.reason}` : ""}</p><button type="button" onClick={() => void loadPlexAccounts()}>Retry</button></div>}
        {plexDiscovery.warnings.map((warning) => <p className={styles.discoveryWarning} key={warning}>{warning}</p>)}
        {data.servers.flatMap((server: any) => data.users.map((user: any) => {
          const accounts = plexAccounts.filter((account) => account.serverId === server.id);
          const mapping = user.plexUserMappings.find((item: any) => item.serverId === server.id);
          const availableMapping = mapping ? accounts.find((account) => account.id === mapping.plexUserId) : null;
          const suggested = accounts.filter((account) => account.username.toLowerCase() === user.username.toLowerCase() || (!!account.email && !!user.email && account.email.toLowerCase() === user.email.toLowerCase()));
          const rowBusy = busy === `map:${user.id}:${server.id}` || busy === `unmap:${user.id}:${server.id}`;
          const assignedElsewhere = (plexUserId: string) => data.users.some((candidate: any) => candidate.id !== user.id && candidate.plexUserMappings.some((item: any) => item.serverId === server.id && item.plexUserId === plexUserId && item.enabled));
          return <div className={styles.mapping} key={`${user.id}:${server.id}`}>
            <span><strong>{user.username}</strong><small>{user.email || "No email"} · {user._count.generatedPlaylists} playlists</small></span>
            <span>{mapping ? <><strong>{mapping.plexUsername || mapping.plexAccount?.username || "Stored Plex account"}</strong><small>{server.name} · {availableMapping ? "Mapped" : "Mapped · Unavailable from current discovery"}</small></> : <><strong>Unmapped</strong><small>{server.name} · {suggested.length ? `${suggested.length} suggested match` : "No confident match"}</small></>}</span>
            <select
              aria-label={`Plex account for ${user.username} on ${server.name}`}
              value={mapping?.plexUserId || ""}
              onChange={(event) => event.target.value ? void mapUser(user, server, event.target.value) : mapping ? void unmapUser(user, server) : undefined}
              disabled={rowBusy || plexDiscovery.status !== "success"}
            >
              <option value="">{rowBusy ? "Saving mapping…" : "Choose Plex account…"}</option>
              {mapping && !availableMapping && <option value={mapping.plexUserId}>{`${mapping.plexUsername || "Stored Plex account"} — Unavailable`}</option>}
              {accounts.map((account) => <option key={account.id} value={account.id} disabled={assignedElsewhere(account.id)}>{formatPlexAccountLabel(account)}{assignedElsewhere(account.id) ? " — Already mapped" : ""}</option>)}
            </select>
            <div className={styles.mappingActions}>{rowBusy && <small>Saving…</small>}{mapping && <button type="button" onClick={() => void unmapUser(user, server)} disabled={rowBusy}>Remove mapping</button>}</div>
          </div>;
        }))}
      </div>
    </section>
    <section id="services"><h2>Media and notification services</h2><div className={styles.grid}>{[["tautulli","Tautulli","Playback signals are privacy-minimized and expire automatically."],["discord","Discord","Share portable recipes without private API tokens."],["notifiarr","Notifiarr","Deliver centralized ecosystem notifications."],["homepage","Homepage","Fast cached widget summaries using widget.read."],["home_assistant","Home Assistant","Flat REST sensor status using home_assistant.read."],["prometheus","Prometheus","Low-cardinality metrics using metrics.read."]].map(([key,name,description]) => { const row: any = integrationMap.get(key); return <article className={styles.card} key={key}><div className={styles.cardHeader}><div><h3>{name}</h3><p>{description}</p></div><span data-tone={stateTone(row?.status || "DISABLED")}>{row?.status || "DISABLED"}</span></div><p>Last success: {date(row?.lastSuccessAt)}</p>{row?.lastFailureReason && <p className={styles.warning}>{row.lastFailureReason}</p>}<button onClick={() => void configure(key, name)} disabled={!!busy}>{row?.enabled ? "Update configuration" : "Configure"}</button></article>; })}</div></section>
    <section id="webhooks"><h2>Signed generic webhooks</h2><div className={styles.split}><div className={styles.subpanel}><label>Name<input value={webhook.displayName} onChange={(e) => setWebhook({ ...webhook, displayName: e.target.value })}/></label><label>HTTPS destination<input value={webhook.destinationUrl} onChange={(e) => setWebhook({ ...webhook, destinationUrl: e.target.value })} placeholder="https://example.invalid/mixarr"/></label><label>Events<select multiple value={webhook.events} onChange={(e) => setWebhook({ ...webhook, events: Array.from(e.target.selectedOptions).map((option) => option.value) })}>{INTEGRATION_EVENTS.map((event) => <option key={event}>{event}</option>)}</select></label><button onClick={() => void createWebhook()} disabled={!!busy || !webhook.destinationUrl}>Create webhook</button></div><div className={styles.subpanel}><h3>Endpoints</h3>{data.endpoints.map((endpoint: any) => <div className={styles.row} key={endpoint.id}><span><strong>{endpoint.displayName}</strong><small>{endpoint.eventsJson?.length || 0} selected events · {endpoint.failureCount || 0} failures</small></span><em data-tone={endpoint.enabled ? "ok" : "muted"}>{endpoint.enabled ? "Enabled" : "Disabled"}</em></div>)}</div></div><div className={styles.subpanel}><h3>Recent delivery history</h3>{data.deliveries.map((delivery: any) => <div className={styles.row} key={delivery.id}><span><strong>{delivery.eventRecord.event}</strong><small>{delivery.endpoint.displayName} · attempt {delivery.attemptNumber} · {delivery.durationMs ?? "—"} ms</small></span><em data-tone={stateTone(delivery.status)}>{delivery.status}</em></div>)}</div></section>
    <section id="tokens"><h2>Scoped API tokens</h2><div className={styles.split}><div className={styles.subpanel}><label>Token name<input value={tokenForm.name} onChange={(e) => setTokenForm({ ...tokenForm, name: e.target.value })}/></label><div className={styles.scopes}>{API_TOKEN_SCOPES.map((scope) => <label key={scope}><input type="checkbox" checked={tokenForm.scopes.includes(scope)} onChange={(e) => setTokenForm({ ...tokenForm, scopes: e.target.checked ? [...tokenForm.scopes, scope] : tokenForm.scopes.filter((item) => item !== scope) })}/>{scope}</label>)}</div><button onClick={() => void createToken()} disabled={!!busy || !tokenForm.name || !tokenForm.scopes.length}>Create token</button>{newToken && <div className={styles.tokenReveal}><strong>Copy now — shown once</strong><code>{newToken}</code><button onClick={() => void copyToken()}>Copy</button></div>}</div><div className={styles.subpanel}>{data.tokens.map((token: any) => <div className={styles.row} key={token.id}><span><strong>{token.name}</strong><small>{token.prefix}… · last used {date(token.lastUsedAt)} · {(token.scopesJson || []).join(", ")}</small></span>{token.enabled ? <button onClick={() => void revokeToken(token.id)} disabled={!!busy}>Revoke</button> : <em data-tone="muted">Revoked</em>}</div>)}</div></div></section>
    <section id="diagnostics"><h2>Health and integration tests</h2><div className={styles.links}><Link href="/health/live">Liveness</Link><Link href="/health/ready">Readiness</Link><Link href="/health/details">Detailed health</Link><Link href="/api/homepage/widget">Homepage widget</Link><Link href="/api/integrations/home-assistant/status">Home Assistant</Link><Link href="/metrics">Prometheus</Link></div><div className={styles.subpanel}>{data.tests.map((test: any) => <div className={styles.row} key={test.id}><span><strong>{test.testKey}</strong><small>{test.safe ? "Read-only" : "May write"} · {test.durationMs} ms · {test.message}</small></span><em data-tone={stateTone(test.status)}>{test.status}</em></div>)}</div></section>
  </main>;
}
