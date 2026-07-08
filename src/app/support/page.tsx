import Link from "next/link";
import { cookies } from "next/headers";
import { ExternalLink, Github, Info, Map, ScrollText } from "lucide-react";
import { getSupportSummary } from "@/lib/support";
import { APP_VERSION } from "@/lib/appVersion";
import { MIXARR_GITHUB_URL } from "@/lib/appInfo";
import SupportActions from "./SupportActions";
import styles from "./support.module.css";

export const metadata = {
  title: "Beta Support | Mixarr",
  description: "Report bugs, share feedback, and copy diagnostics for Mixarr beta testing.",
};

export default async function SupportPage() {
  const userId = cookies().get("mixarr_session")?.value;
  const summary = userId ? await getSupportSummary(userId).catch(() => null) : null;
  const links = summary?.links || { githubRepoUrl: MIXARR_GITHUB_URL, discordSupportUrl: null, discordConfigured: false };
  const app = summary?.app || { version: APP_VERSION, buildDate: null, gitCommit: null, runtimeMode: "unknown", serverTime: new Date().toISOString() };
  const worker = summary?.worker;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>Beta</span>
          <h2>Beta Support</h2>
          <p>Report bugs, share feedback, and copy diagnostics for Mixarr beta testing.</p>
        </div>
      </header>

      <section className={styles.betaBlock}>
        <Info size={18} />
        <div>
          <h3>Mixarr is currently in beta.</h3>
          <p>Features may change, and diagnostics help improve reliability.</p>
          <div className={styles.inlineLinks}>
            <Link href="/release-notes">Release notes</Link>
            <Link href="/roadmap">Roadmap</Link>
            <a href={links.githubRepoUrl} target="_blank" rel="noopener noreferrer">GitHub beta repo</a>
            {links.discordConfigured && links.discordSupportUrl && <a href={links.discordSupportUrl} target="_blank" rel="noopener noreferrer">Discord support</a>}
          </div>
        </div>
      </section>

      <section className={styles.aboutGrid}>
        <article className={styles.aboutCard}>
          <h3>About Mixarr</h3>
          <dl>
            <div><dt>App</dt><dd>Mixarr {app.version} Beta</dd></div>
            <div><dt>Build</dt><dd>{app.buildDate || "unknown"}</dd></div>
            <div><dt>Commit</dt><dd>{app.gitCommit || "unknown"}</dd></div>
            <div><dt>Runtime</dt><dd>{summary?.environment?.dockerDetected ? "Docker" : app.runtimeMode || "unknown"}</dd></div>
            <div><dt>Worker</dt><dd>{worker?.status || "unknown"}</dd></div>
            <div><dt>Scheduler</dt><dd>{summary?.configuredFeatures?.scheduler ? "Enabled" : "Disabled"}</dd></div>
            <div><dt>Server time</dt><dd>{app.serverTime}</dd></div>
            <div><dt>Plex libraries</dt><dd>{summary?.plex?.libraryCount ?? 0}</dd></div>
          </dl>
        </article>

        <article className={styles.aboutCard}>
          <h3>What to include</h3>
          <ul>
            <li>What page or feature you were using.</li>
            <li>What you expected and what happened instead.</li>
            <li>Recent job status if sync, enrichment, or analysis failed.</li>
            <li>Exported diagnostics JSON when requested.</li>
            <li>Screenshots if they make the issue clearer.</li>
          </ul>
        </article>
      </section>

      <section className={styles.linkCards}>
        <article className={styles.card}>
          <h3>GitHub Beta Repo</h3>
          <p>View releases, issues, and source updates for the Mixarr beta.</p>
          <a className={styles.primaryButton} href={links.githubRepoUrl} target="_blank" rel="noopener noreferrer">
            <Github size={15} /> Open GitHub <ExternalLink size={13} />
          </a>
        </article>
        <article className={styles.card}>
          <h3>Release Notes & Roadmap</h3>
          <p>Check what changed in {APP_VERSION} and what is coming next.</p>
          <div className={styles.buttonRow}>
            <Link href="/release-notes" className={styles.secondaryButton}><ScrollText size={15} /> View Release Notes</Link>
            <Link href="/roadmap" className={styles.secondaryButton}><Map size={15} /> View Roadmap</Link>
          </div>
        </article>
      </section>

      {summary ? (
        <SupportActions summary={summary as any} />
      ) : (
        <div className={styles.error}>Connect Plex to generate support templates and diagnostics.</div>
      )}
    </main>
  );
}
