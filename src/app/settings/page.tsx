import Link from "next/link";
import { cookies } from "next/headers";
import { Settings as SettingsIcon, Ban, Database, ExternalLink, Github, HeartPulse, Info, Key, LifeBuoy, Map, RefreshCw, ScrollText, Server, ShieldCheck } from "lucide-react";
import ProviderTestButton from "@/components/ProviderTestButton";
import ExternalApiSettingsPanel from "@/components/ExternalApiSettingsPanel";
import LibraryDefaultSelector from "@/components/LibraryDefaultSelector";
import SyncOptionsForm from "@/components/SyncOptionsForm";
import BackgroundSchedulerSettings from "@/components/BackgroundSchedulerSettings";
import TrackExclusionsManager from "@/components/TrackExclusionsManager";
import WorkerHealthCard from "@/components/WorkerHealthCard";
import { APP_DESCRIPTION, APP_NAME, MIXARR_GITHUB_URL } from "@/lib/appInfo";
import { APP_VERSION } from "@/lib/appVersion";
import { getExternalApiSettingsPayload } from "@/lib/externalApiSettings";
import { getAppReadiness } from "@/lib/readiness";
import styles from "./settings.module.css";

export default async function SettingsPage() {
  const userId = cookies().get("mixarr_session")?.value;
  const [readiness, externalApis] = await Promise.all([
    getAppReadiness({ userId }).catch(() => null),
    getExternalApiSettingsPayload().catch(() => null),
  ]);
  const readinessChecks = readiness?.checks ? Object.values(readiness.checks) : [];
  const validationMessages = readinessChecks
    .filter((item) => item.status === "Warning" || item.status === "Error")
    .map((item) => item.summary);

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <h2>
          <SettingsIcon size={28} color="var(--accent)" /> Settings
        </h2>
        <p>Manage your configuration and connections.</p>
      </header>

      <Link href="/settings/library-health" className={`glass-panel ${styles.healthLink}`}>
        <HeartPulse size={24} />
        <span>
          <strong>Library Health &amp; Cleanup</strong>
          <small>Verify Plex reconciliation, inspect missing tracks, export records, and run safe cleanup.</small>
        </span>
        <span aria-hidden="true">&rarr;</span>
      </Link>

      <section className={`glass-panel ${styles.section} ${styles.aboutSection}`} aria-labelledby="about-mixarr">
        <div className={styles.aboutHeader}>
          <span className={styles.aboutIcon}>
            <Info size={20} />
          </span>
          <div>
            <h3 id="about-mixarr" className={styles.sectionTitle}>{APP_NAME}</h3>
            <p>{APP_DESCRIPTION}</p>
          </div>
          <span className={styles.versionBadge}>{APP_VERSION}</span>
        </div>
        <dl className={styles.aboutRows}>
          <div>
            <dt>Current version</dt>
            <dd>{APP_VERSION}</dd>
          </div>
          <div>
            <dt>Beta label</dt>
            <dd>Beta</dd>
          </div>
          <div>
            <dt>GitHub repo</dt>
            <dd><a href={MIXARR_GITHUB_URL} target="_blank" rel="noopener noreferrer">cvarano84/mixarr-beta</a></dd>
          </div>
          <div>
            <dt>Build metadata</dt>
            <dd>Build date: {process.env.BUILD_DATE || process.env.NEXT_PUBLIC_BUILD_DATE || "Unknown"} · Commit: {process.env.GIT_COMMIT || process.env.NEXT_PUBLIC_GIT_COMMIT || "Unknown"} · Runtime: {process.env.NODE_ENV || "Unknown"} · Docker: {process.env.DOCKER === "1" || process.env.CONTAINER === "1" ? "Yes" : "Unknown"}</dd>
          </div>
          <div>
            <dt>Update status</dt>
            <dd>Update checks are currently manual. View GitHub releases to compare your installed version with the latest available build.</dd>
          </div>
        </dl>
        <div className={styles.aboutActions}>
          <Link href="/release-notes" className={styles.secondaryButton}>
            <ScrollText size={16} />
            View Release Notes
          </Link>
          <Link href="/roadmap" className={styles.secondaryButton}>
            <Map size={16} />
            View Roadmap
          </Link>
          <Link href="/support" className={styles.secondaryButton}>
            <LifeBuoy size={16} />
            Beta Support
          </Link>
          <a href={MIXARR_GITHUB_URL} target="_blank" rel="noopener noreferrer" className={styles.secondaryButton}>
            <Github size={16} />
            Open GitHub
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        </div>
      </section>

      <section className={`glass-panel ${styles.section}`} aria-labelledby="app-readiness">
        <h3 id="app-readiness" className={styles.sectionTitle}>
          <ShieldCheck size={20} color="var(--info)" /> App Readiness
        </h3>
        <p className={styles.sectionDesc}>
          Compact startup and configuration checks for Mixarr {APP_VERSION} Beta.
        </p>
        {readinessChecks.length > 0 ? (
          <div className={styles.readinessGrid}>
            {readinessChecks.map((item) => (
              <div key={item.label} className={styles.readinessItem}>
                <span>{item.label}</span>
                <strong data-status={item.status}>{item.status}</strong>
                <small>{item.summary}</small>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.errorText}>No support diagnostics are available yet.</p>
        )}
        {validationMessages.length > 0 && (
          <div className={styles.validationList}>
            {validationMessages.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
        )}
      </section>

      {/* API Keys & Integrations */}
      <section className={`glass-panel ${styles.section}`}>
        <h3 className={styles.sectionTitle}>
          <Key size={20} color="var(--info)" /> External APIs
        </h3>
        {externalApis ? (
          <ExternalApiSettingsPanel initialPayload={externalApis} />
        ) : (
          <p className={styles.errorText}>External API settings are unavailable. Check database readiness and migrations.</p>
        )}
      </section>

      {/* Plex Connection */}
      <section className={`glass-panel ${styles.section}`}>
        <h3 className={styles.sectionTitle}>
          <Server size={20} color="var(--warning)" /> Plex Identity
        </h3>
        <div className={styles.providerList}>
          <ProviderTestButton 
            provider="plex"
            title="Local Plex Server"
            description="The current active Plex Media Server that hosts your library."
            badgeText="OAuth Linked"
            badgeColor="#eab308"
          />
          <div className={styles.field}>
            <label>Client Identifier</label>
            <input type="text" readOnly value={process.env.PLEX_CLIENT_IDENTIFIER || "Not Set"} className={styles.readonlyInput} />
          </div>
          <div className={styles.field}>
            <label>Product Name</label>
            <input type="text" readOnly value={process.env.PLEX_PRODUCT_NAME || "Mixarr"} className={styles.readonlyInput} />
          </div>
          <div className={styles.divider}>
            <h4>Default Playlist Source</h4>
            <LibraryDefaultSelector />
          </div>
        </div>
      </section>

      {/* Sync Controls */}
      <section className={`glass-panel ${styles.section}`}>
        <h3 className={styles.sectionTitle}>
          <RefreshCw size={20} color="var(--accent)" /> Sync Controls
        </h3>
        <p className={styles.sectionDesc}>
          Tune how much metadata each manual sync run processes. Leave a field empty to remove that batch cap.
        </p>
        <SyncOptionsForm />
      </section>

      <section className={`glass-panel ${styles.section}`}>
        <h3 className={styles.sectionTitle}>
          <RefreshCw size={20} color="var(--accent)" /> Background Scheduler
        </h3>
        <p className={styles.sectionDesc}>
          Control when Mixarr automatically runs background sync and analysis jobs.
        </p>
        <WorkerHealthCard />
        <BackgroundSchedulerSettings />
      </section>

      <section className={`glass-panel ${styles.section}`}>
        <h3 className={styles.sectionTitle}>
          <Ban size={20} color="var(--warning)" /> Track Exclusions
        </h3>
        <TrackExclusionsManager />
      </section>

      {/* Database Management */}
      <section className={styles.dangerSection}>
        <h3>
          <Database size={20} /> Data Management
        </h3>
        <p className={styles.sectionDesc}>
          These actions are performed automatically by the background engines, but you can manually trigger them or completely reset your cache if needed.
        </p>
        <div className={styles.dangerActions}>
          <button className={styles.dangerBtn}>
            Reset Database Cache
          </button>
        </div>
      </section>
    </div>
  );
}
